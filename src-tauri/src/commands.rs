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
    pub process_with_caption: bool,
    #[serde(default = "default_true")]
    pub rev_order: bool,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
}

fn default_temperature() -> f32 {
    1.1
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
            process_with_caption: false,
            rev_order: true,
            temperature: 1.1,
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

    if let Some(err) = json.get("error") {
        let code = err["error_code"].as_i64().unwrap_or(0);
        let msg = err["error_msg"].as_str().unwrap_or("неизвестная ошибка");
        return Err(format!("VK API ошибка {}: {}", code, msg));
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

#[tauri::command]
pub async fn generate_caption(state: State<'_, AppState>, image_url: String, system_prompt: String, user_comment: Option<String>) -> Result<String, String> {
    let (model, temperature) = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        (s.lmstudio_model.clone(), s.temperature)
    };
    let client = state.client.clone();
    let bytes = client.get(&image_url).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
    let b64 = general_purpose::STANDARD.encode(&bytes);
    let data_uri = format!("data:image/jpeg;base64,{}", b64);

    const SYSTEM_RETRY: &str = "Ответ должен быть строго JSON-массивом строк. Ничего кроме этого. Пример: [\"тег1\", \"тег2\"]";

    let base_user_text = match &user_comment {
        Some(c) if !c.trim().is_empty() => format!("Дополнительно: {}\nВнимание: верни ТОЛЬКО JSON-массив.", c),
        _ => "Внимание: верни ТОЛЬКО JSON-массив.".to_string(),
    };

    let mut last_caption = String::new();

    for attempt in 1u8..=3 {
        let (system_msg, user_text) = if attempt > 1 {
            (SYSTEM_RETRY.to_string(), "Верни только JSON-массив!".to_string())
        } else {
            (system_prompt.clone(), base_user_text.clone())
        };

        let body = serde_json::json!({
            "model": model,
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": data_uri}}
                ]}
            ],
            "temperature": temperature,
        });

        let resp = client.post("http://localhost:1234/v1/chat/completions")
            .json(&body).send().await.map_err(|e| e.to_string())?;
        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let raw = json["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
        let caption = parse_caption(&raw);

    if !caption.is_empty() && caption.contains('"') {
            return Ok(caption);
        }

        last_caption = caption;
    }

    Ok(last_caption)
}

#[tauri::command]
pub async fn save_photo_caption(state: State<'_, AppState>, photo_id: u64, owner_id: i64, caption: String) -> Result<(), String> {
    let vk_token = { let s = state.settings.lock().map_err(|e| e.to_string())?; s.vk_token.clone() };
    let client = state.client.clone();
    let params = [("photo_id", photo_id.to_string()), ("owner_id", owner_id.to_string()), ("caption", caption), ("access_token", vk_token), ("v", "5.131".to_string())];
    let resp = client.post("https://api.vk.com/method/photos.edit").form(&params).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if json["error"].is_object() { return Err(format!("VK Error: {:?}", json["error"])); }
    Ok(())
}

#[tauri::command]
pub async fn list_lmstudio_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let client = state.client.clone();
    let resp = client.get("http://localhost:1234/v1/models")
        .send()
        .await
        .map_err(|e| format!("Ошибка подключения к LMStudio: {}", e))?;

    let json: ModelsResponse = resp.json().await
        .map_err(|e| format!("Ошибка парсинга ответа от LMStudio: {}", e))?;

    Ok(json.data.into_iter().map(|m| m.id).collect())
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
