use base64::{engine::general_purpose, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;



#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub vk_token: String,
    pub vk_album_id: String,
    pub vk_owner_id: String,
    pub lmstudio_model: String,
    #[serde(default)]
    pub lmstudio_token: String,
    #[serde(default)]
    pub process_with_caption: bool,
    #[serde(default = "default_true")]
    pub rev_order: bool,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_image_mode")]
    pub image_transmission_mode: String,
    #[serde(default)]
    pub lmstudio_integrations: String,
}

fn default_temperature() -> f32 {
    1.1
}

fn default_image_mode() -> String {
    "direct".to_string()
}


fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            vk_token: String::new(),
            vk_album_id: String::new(),
            vk_owner_id: String::new(),
            lmstudio_model: "google/gemma-3-12b".to_string(),
            lmstudio_token: String::new(),
            process_with_caption: false,
            rev_order: true,
            temperature: 1.1,
            image_transmission_mode: "direct".to_string(),
            lmstudio_integrations: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoSize {
    pub url: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "type")]
    pub size_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoTask {
    pub id: u64,
    pub owner_id: i64,
    pub album_id: u64,
    pub image_url: String,
    pub caption: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub client: Client,
    /// Последняя скачанная картинка (url, data-url): одно и то же фото уходит в модель
    /// несколько раз — генерация, ревью, перегенерация
    pub last_image: Mutex<Option<(String, String)>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub object: String,
    pub owned_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsResponse {
    pub data: Vec<ModelInfo>,
    pub object: String,
}

impl Default for AppState {
    fn default() -> Self {
        // Используем стандартный клиент с таймаутами. 
        // Принудительный HTTP/1.1 мог вызвать проблемы с VK API.
        let client = Client::builder()
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            settings: Mutex::new(AppSettings::default()),
            client,
            last_image: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(settings.clone())
}

#[tauri::command]
pub fn save_settings(app: AppHandle, state: State<AppState>, settings: AppSettings) -> Result<(), String> {
    let mut current = state.settings.lock().map_err(|e| e.to_string())?;
    *current = settings.clone();
    drop(current);
    if let Some(store) = app.get_store("settings") {
        let json = serde_json::to_value(&settings).map_err(|e| e.to_string())?;
        store.set("app_settings", json);
        let _ = store.save();
    }
    Ok(())
}

/// Коды VK, которые однозначно означают проблему с токеном, а не с лимитами или доступом.
const VK_AUTH_ERROR_CODES: [i64; 4] = [5, 17, 27, 28];

const VK_AUTH_HINT: &str = "Откройте Настройки, проверьте VK Token и нажмите «Сохранить»: запросы уходят с токеном из последнего сохранения, а не с тем, что набран в поле.";

#[tauri::command]
pub async fn load_photos_without_caption(state: State<'_, AppState>) -> Result<Vec<PhotoTask>, String> {
    let (vk_token, album_id, owner_id, process_with_caption, rev_order) = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        (s.vk_token.clone(), s.vk_album_id.clone(), s.vk_owner_id.clone(), s.process_with_caption, s.rev_order)
    };

    if vk_token.is_empty() {
        return Err("VK Token не заполнен. Перейдите в Настройки и сохраните токен.".to_string());
    }
    if album_id.is_empty() {
        return Err("Album ID не заполнен. Перейдите в Настройки и сохраните ID альбома.".to_string());
    }

    let client_ref = &state.client;
    
    let fetch_batch = |offset: u64| {
        let mut params = vec![
            ("album_id", album_id.clone()),
            ("access_token", vk_token.clone()),
            ("v", "5.131".to_string()),
            ("count", "1000".to_string()),
            ("offset", offset.to_string()),
        ];
        if !owner_id.is_empty() {
            params.push(("owner_id", owner_id.clone()));
        }
        if rev_order {
            params.push(("rev", "1".to_string()));
        }
        
        let client = client_ref.clone();
        async move {
            client.get("https://api.vk.com/method/photos.get")
                .query(&params)
                .send()
                .await
        }
    };

    let resp = fetch_batch(0).await
        .map_err(|e| format!("Ошибка соединения с VK: {}", e))?;

    let mut json: serde_json::Value = resp.json().await
        .map_err(|e| format!("Ошибка парсинга ответа VK: {}", e))?;

    if let Some((code, msg)) = vk_error_parts(&json) {
        return Err(vk_error_message(&state.client, &vk_token, code, &msg).await);
    }

    let items_array = json["response"]["items"].as_array()
        .ok_or_else(|| "Неверный формат ответа VK".to_string())?;

    let mut items = items_array.clone();
    let total_count = json["response"]["count"].as_u64().unwrap_or(0);

    // Если запрошен обратный порядок и альбом большой
    if rev_order && total_count > items.len() as u64 {
        let first_date = items.first().and_then(|i| i["date"].as_i64()).unwrap_or(0);
        let last_date = items.last().and_then(|i| i["date"].as_i64()).unwrap_or(0);
        
        // Если API вернул начало альбома (старые фото)
        if first_date <= last_date {
            let offset = total_count.saturating_sub(1000);
            if offset > 0 {
                let resp = fetch_batch(offset).await
                    .map_err(|e| format!("Ошибка повторного запроса к VK: {}", e))?;
                json = resp.json().await
                    .map_err(|e| format!("Ошибка парсинга повторного ответа VK: {}", e))?;
                
                items = json["response"]["items"].as_array()
                    .ok_or_else(|| "Ошибка при получении последней страницы фото".to_string())?
                    .clone();
            }
        }
    }

    // Реверсируем, если даты в наборе идут от старых к новым
    if rev_order && items.len() > 1 {
        let first_date = items.first().and_then(|i| i["date"].as_i64()).unwrap_or(0);
        let last_date = items.last().and_then(|i| i["date"].as_i64()).unwrap_or(0);
        if first_date < last_date {
            items.reverse();
        }
    }

    let total = items.len();
    let mut photos = Vec::new();

    for item in items {
        let text = item["text"].as_str().unwrap_or("");
        if process_with_caption || text.trim().is_empty() {
            let sizes: Vec<PhotoSize> = item["sizes"].as_array().map(|arr| {
                arr.iter().filter_map(|sz| {
                    Some(PhotoSize {
                        url: sz["url"].as_str()?.to_string(),
                        width: sz["width"].as_u64()? as u32,
                        height: sz["height"].as_u64()? as u32,
                        size_type: sz["type"].as_str().map(String::from),
                    })
                }).collect()
            }).unwrap_or_default();

            photos.push(PhotoTask {
                id: item["id"].as_u64().unwrap_or(0),
                owner_id: item["owner_id"].as_i64().unwrap_or(0),
                album_id: item["album_id"].as_u64().unwrap_or(0),
                image_url: get_optimal_size(&sizes),
                caption: text.to_string(),
                status: "pending".into(),
                error: None,
            });
        }
    }

    if photos.is_empty() && total > 0 {
        return Err(format!(
            "Все {} фото в альбоме уже имеют описания.",
            total
        ));
    }

    if total == 0 {
        return Err("Альбом пуст или недоступен. Проверьте Album ID и Owner ID.".to_string());
    }

    Ok(photos)
}

/// Настройки обращения к LM Studio, общие для генерации и ревью описаний.
struct LmConfig {
    model: String,
    temperature: f32,
    image_mode: String,
    token: String,
    integrations: String,
}

impl LmConfig {
    fn load(state: &State<'_, AppState>) -> Result<Self, String> {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        Ok(Self {
            model: s.lmstudio_model.clone(),
            temperature: s.temperature,
            image_mode: s.image_transmission_mode.clone(),
            token: s.lmstudio_token.clone(),
            integrations: s.lmstudio_integrations.clone(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptionReview {
    pub ok: bool,
    pub comment: String,
}

#[tauri::command]
pub async fn generate_caption(state: State<'_, AppState>, image_url: String, system_prompt: String, user_comment: Option<String>) -> Result<String, String> {
    let cfg = LmConfig::load(&state)?;
    let client = state.client.clone();
    let image_content_url = fetch_image_data_url(&state, &image_url, &cfg.image_mode).await?;

    const SYSTEM_RETRY: &str = "Ответ должен быть строго JSON-массивом строк. Ничего кроме этого. Пример: [\"тег1\", \"тег2\"]";

    let base_user_text = match &user_comment {
        Some(c) if !c.trim().is_empty() => format!("Дополнительно: {}\nВнимание: верни ТОЛЬКО JSON-массив.", c),
        _ => "Внимание: верни ТОЛЬКО JSON-массив.".to_string(),
    };

    let mut last_caption = String::new();

    for attempt in 1u8..=3 {
        let system_msg = if attempt > 1 {
            SYSTEM_RETRY.to_string()
        } else {
            system_prompt.clone()
        };

        let mut user_text = if attempt > 1 {
            "Верни только JSON-массив!".to_string()
        } else {
            base_user_text.clone()
        };

        if cfg.image_mode == "mixed" || cfg.image_mode == "path" {
            user_text = format!("{}\n\nURL\\Path images: {}", user_text, image_url);
        }

        let raw = lm_chat(&client, &cfg, &system_msg, &user_text, &image_content_url).await?;
        let caption = parse_caption(&raw);

    if !caption.is_empty() && caption.contains('"') {
            return Ok(caption);
        }

        last_caption = caption;
    }

    Ok(last_caption)
}

/// Второй проход по готовому описанию: модель проверяет его по тем же правилам
/// и, если что-то не так, пишет замечание — им же мы запускаем перегенерацию.
#[tauri::command]
pub async fn review_caption(
    state: State<'_, AppState>,
    image_url: String,
    caption: String,
    system_prompt: String,
    review_prompt: String,
    temperature: f32,
) -> Result<CaptionReview, String> {
    // Ревью должно быть предсказуемым, поэтому температура своя, не как у генерации
    let cfg = LmConfig { temperature, ..LmConfig::load(&state)? };
    let client = state.client.clone();
    let image_content_url = fetch_image_data_url(&state, &image_url, &cfg.image_mode).await?;

    let mut user_text = format!(
        "Правила, по которым составлялось описание:\n{}\n\nПредложенное описание:\n{}\n\nВерни ТОЛЬКО JSON-объект: {{\"ok\": true}} или {{\"ok\": false, \"comment\": \"что именно исправить\"}}.",
        system_prompt, caption
    );

    if cfg.image_mode == "mixed" || cfg.image_mode == "path" {
        user_text = format!("{}\n\nURL\\Path images: {}", user_text, image_url);
    }

    let raw = lm_chat(&client, &cfg, &review_prompt, &user_text, &image_content_url).await?;
    println!("[review] ответ модели: {}", raw);

    let review = parse_review(&raw);
    println!("[review] вердикт ok={} comment={}", review.ok, review.comment);

    Ok(review)
}

#[tauri::command]
pub async fn save_photo_caption(state: State<'_, AppState>, photo_id: u64, owner_id: i64, caption: String) -> Result<(), String> {
    let vk_token = { let s = state.settings.lock().map_err(|e| e.to_string())?; s.vk_token.clone() };
    let client = state.client.clone();
    let params = [("photo_id", photo_id.to_string()), ("owner_id", owner_id.to_string()), ("caption", caption), ("access_token", vk_token.clone()), ("v", "5.131".to_string())];
    let resp = client.post("https://api.vk.com/method/photos.edit").form(&params).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if let Some((code, msg)) = vk_error_parts(&json) {
        return Err(vk_error_message(&client, &vk_token, code, &msg).await);
    }
    Ok(())
}

#[tauri::command]
pub async fn list_lmstudio_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let client = state.client.clone();
    let lm_token = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        s.lmstudio_token.clone()
    };
    
    let mut req = client.get("http://localhost:1234/v1/models");
    if !lm_token.is_empty() {
        req = req.bearer_auth(&lm_token);
    }
    
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Ошибка подключения к LMStudio: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("LMStudio вернул ошибку {}: {}", status, err_body));
    }

    let json: ModelsResponse = resp.json().await
        .map_err(|e| format!("Ошибка парсинга ответа от LMStudio: {}", e))?;

    Ok(json.data.into_iter().map(|m| m.id).collect())
}

/// Скачивает картинку и кодирует её в data-URL. В режиме "path" модель получает только ссылку.
/// Последний результат держим в памяти: ревью и перегенерация просят то же самое фото.
async fn fetch_image_data_url(state: &State<'_, AppState>, image_url: &str, image_mode: &str) -> Result<String, String> {
    if image_mode == "path" {
        return Ok(String::new());
    }

    {
        let cached = state.last_image.lock().map_err(|e| e.to_string())?;
        if let Some((url, data)) = cached.as_ref() {
            if url == image_url {
                println!("[lm] картинка взята из кэша: {}", image_url);
                return Ok(data.clone());
            }
        }
    }

    let bytes = state.client.get(image_url).send().await.map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;
    let data_url = format!("data:image/jpeg;base64,{}", general_purpose::STANDARD.encode(&bytes));

    let mut cached = state.last_image.lock().map_err(|e| e.to_string())?;
    *cached = Some((image_url.to_string(), data_url.clone()));

    Ok(data_url)
}

/// Один запрос к LM Studio. Пустой image_data_url означает запрос без картинки.
async fn lm_chat(client: &Client, cfg: &LmConfig, system_prompt: &str, user_text: &str, image_data_url: &str) -> Result<String, String> {
    let mut content_array = vec![serde_json::json!({"type": "text", "content": user_text})];
    if !image_data_url.is_empty() {
        content_array.push(serde_json::json!({"type": "image", "data_url": image_data_url}));
    }

    let mut body = serde_json::json!({
        "model": cfg.model,
        "system_prompt": system_prompt,
        "input": content_array,
        "temperature": cfg.temperature,
    });

    if !cfg.integrations.trim().is_empty() {
        let parsed = serde_json::from_str::<serde_json::Value>(&cfg.integrations)
            .map_err(|e| format!("Ошибка парсинга JSON в поле Интеграции: {}\nПроверьте, что все ключи в двойных кавычках!", e))?;
        if !parsed.is_array() {
            return Err(format!("Поле Интеграции должно быть JSON массивом: {}", cfg.integrations));
        }
        body["integrations"] = parsed;
    }

    let mut req = client.post("http://localhost:1234/api/v1/chat").json(&body);
    if !cfg.token.is_empty() {
        req = req.bearer_auth(&cfg.token);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let mut raw = String::new();
    if let Some(arr) = json["output"].as_array() {
        for item in arr {
            if let Some(c) = item["content"].as_str() {
                raw.push_str(c);
            }
        }
    }

    Ok(raw)
}

/// Разбирает вердикт ревью. Непонятный ответ не должен останавливать конвейер,
/// поэтому считаем описание принятым.
fn parse_review(raw: &str) -> CaptionReview {
    let Some(value) = extract_json_object(raw) else {
        println!("[review] ответ не разобран, описание принято без замечаний");
        return CaptionReview { ok: true, comment: String::new() };
    };

    let comment = value["comment"].as_str().unwrap_or("").trim().to_string();
    let ok = value["ok"].as_bool().unwrap_or(comment.is_empty());

    if !ok && comment.is_empty() {
        return CaptionReview {
            ok,
            comment: "Описание не прошло проверку. Составь другое, строго по правилам.".to_string(),
        };
    }

    CaptionReview { ok, comment }
}

/// Вытаскивает вердикт из ответа модели, даже если вокруг него есть рассуждения или Markdown.
/// Модели с thinking ставят фигурные скобки и до самого вердикта, поэтому пробуем разобрать
/// объект от каждой открывающей скобки и берём первый, похожий на вердикт.
fn extract_json_object(raw: &str) -> Option<serde_json::Value> {
    for (start, _) in raw.match_indices('{') {
        let mut objects = serde_json::Deserializer::from_str(&raw[start..]).into_iter::<serde_json::Value>();

        if let Some(Ok(value)) = objects.next() {
            if value.get("ok").is_some() || value.get("comment").is_some() {
                return Some(value);
            }
        }
    }

    None
}

/// Достаёт код и текст ошибки из ответа VK.
fn vk_error_parts(json: &serde_json::Value) -> Option<(i64, String)> {
    let err = json.get("error")?;
    let code = err["error_code"].as_i64().unwrap_or(0);
    let msg = err["error_msg"].as_str().unwrap_or("неизвестная ошибка").to_string();
    Some((code, msg))
}

/// Превращает ошибку VK в понятный пользователю текст.
/// Для кодов лимитов (Flood control и прочее) дополнительно проверяет токен: VK отвечает
/// антифлудом в том числе на запросы с протухшим токеном, и настоящая причина теряется.
async fn vk_error_message(client: &Client, token: &str, code: i64, msg: &str) -> String {
    println!("[vk] error_code={} error_msg={}", code, msg);

    if VK_AUTH_ERROR_CODES.contains(&code) {
        return format!("Ошибка авторизации VK ({}): {}. {}", code, msg, VK_AUTH_HINT);
    }

    match code {
        // Эти коды VK отдаёт и на мёртвый токен тоже («token required», антифлуд по протухшему
        // токену), поэтому причину уточняем отдельной проверкой
        6 | 9 | 15 | 29 | 200 => {
            if let Some(auth_code) = vk_token_auth_error(client, token).await {
                return format!(
                    "Ошибка авторизации VK: токен недействителен или устарел (код проверки {}). {}",
                    auth_code, VK_AUTH_HINT
                );
            }

            match code {
                15 | 200 => format!("Нет доступа ({}): {}. Проверьте Album ID и Owner ID в Настройках.", code, msg),
                _ => format!("VK API ошибка {}: {}. Слишком много запросов к VK — подождите немного и повторите.", code, msg),
            }
        }
        100 => format!("VK API ошибка {}: {}. Проверьте Album ID и Owner ID в Настройках.", code, msg),
        _ => format!("VK API ошибка {}: {}", code, msg),
    }
}

/// Проверяет токен лёгким запросом. Возвращает код ошибки авторизации, если токен мёртв.
async fn vk_token_auth_error(client: &Client, token: &str) -> Option<i64> {
    let resp = client
        .get("https://api.vk.com/method/users.get")
        .query(&[("access_token", token), ("v", "5.131")])
        .send()
        .await
        .ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    let code = json["error"]["error_code"].as_i64()?;
    println!("[vk] проверка токена users.get -> error_code={}", code);

    VK_AUTH_ERROR_CODES.contains(&code).then_some(code)
}

fn get_optimal_size(sizes: &[PhotoSize]) -> String {
    if sizes.is_empty() { return String::new(); }
    let max_side = |s: &PhotoSize| s.width.max(s.height);
    let mut sorted = sizes.to_vec();
    sorted.sort_by(|a, b| max_side(b).cmp(&max_side(a)));

    // 1. В диапазоне [768, 1920] — ближайшее к 1280
    let in_range: Vec<&PhotoSize> = sorted.iter().filter(|s| max_side(s) >= 768 && max_side(s) <= 1920).collect();
    if !in_range.is_empty() {
        return in_range.iter().min_by_key(|s| (max_side(s) as i32 - 1280).abs()).unwrap().url.clone();
    }
    // 2. Всё меньше 768 — берём максимальный
    if max_side(&sorted[0]) < 768 { return sorted[0].url.clone(); }
    // 3. Всё больше 1920 — берём минимально превышающий
    let mut above: Vec<&PhotoSize> = sorted.iter().filter(|s| max_side(s) > 1920).collect();
    above.sort_by_key(|s| max_side(s));
    above.first().map(|s| s.url.clone()).unwrap_or_else(|| sorted.last().unwrap().url.clone())
}

fn parse_caption(raw: &str) -> String {
    let items = extract_items(raw);
    if items.is_empty() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        // Безопасное ограничение по символам (не по байтам!), чтобы не упасть на русских буквах
        return format!("\"{}\"", trimmed.chars().take(100).collect::<String>());
    }

    let result = items.iter().map(|s| format!("\"{}\"", s)).collect::<Vec<_>>().join(",\n");

    result

}

fn extract_items(raw: &str) -> Vec<String> {
    let svc: &[&str] = &["текст", "подсказка", "prompt", "hint", "image", "description", "жанр", "аниме", "стиль", "объект", "цвет", 
        "text", "tags", "tag", "теги", "тег", "описание", "caption", "игра", "скриншот", "диалог", "персонаж", "фон", "фото", "изображение", "рисунок", "комната", "интерьер", "окно", "текстом"];

    // Пробуем честный JSON-массив
    let mut depth = 0i32;
    let mut start = None;
    let chars: Vec<char> = raw.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if c == '[' { if depth == 0 { start = Some(i); } depth += 1; }
        else if c == ']' {
            depth -= 1;
            if depth == 0 {
                if let Some(s) = start {
                    let slice: String = chars[s..=i].iter().collect();
                    if let Ok(parsed) = serde_json::from_str::<Vec<String>>(&slice) {
                        return parsed.into_iter()
                            .filter(|t| !t.trim().is_empty() && !svc.contains(&t.to_lowercase().trim()))
                            .take(5).collect();
                    }
                }
            }
        }
    }

    // Fallback: извлекаем строки в кавычках (включая «», "", "")
    let mut items: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    // Простой парсер по парам кавычек ASCII
    let mut in_quote = false;
    let mut cur = String::new();
    for c in raw.chars() {
        if c == '"' {
            if in_quote {
                let t = cur.trim().to_string();
                if !t.is_empty() && !svc.contains(&t.to_lowercase().as_str()) && seen.insert(t.clone()) {
                    items.push(t);
                }
                cur = String::new();
                in_quote = false;
            } else {
                in_quote = true;
            }
        } else if in_quote {
            cur.push(c);
        }
    }
    items.into_iter().take(5).collect()
}
