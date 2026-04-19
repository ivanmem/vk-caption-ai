use base64::{engine::general_purpose, Engine as _};
use image::{imageops::FilterType, ImageReader};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::commands::AppState;

/// Максимальная сторона изображения, отправляемого в LMStudio.
/// Большие webp/png с диска кладут локальный сервер (connection reset),
/// поэтому пережимаем до разумного размера — это ещё и ускоряет vision-инференс.
const MAX_IMAGE_SIDE: u32 = 1280;
/// Качество JPEG при перекодировании. 85 — оптимум по размеру/качеству для классификации.
const JPEG_QUALITY: u8 = 85;

// ─────────────────────────── Типы ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageFile {
    /// Полный путь к файлу
    pub path: String,
    /// Имя файла (без пути)
    pub name: String,
    /// Размер в байтах
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyResult {
    /// Сырой ответ модели (для отладки)
    pub raw: String,
    /// Распознанная папка после нормализации (None — модель явно сказала «пропустить»)
    pub folder: Option<String>,
    /// Признак, что распознавание не удалось (ответ не совпал ни с одной папкой)
    pub matched: bool,
}

// Поддерживаемые расширения изображений
const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif",
];

// ─────────────────────── Команды Tauri ───────────────────────

/// Сканирует папку (без рекурсии) и возвращает список изображений
#[tauri::command]
pub fn organizer_list_images(folder: String) -> Result<Vec<ImageFile>, String> {
    let path = Path::new(&folder);
    if !path.is_dir() {
        return Err(format!("Папка не найдена: {}", folder));
    }

    let mut result = Vec::new();
    let entries = std::fs::read_dir(path).map_err(|e| format!("Не удалось прочитать папку: {}", e))?;

    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }

        let ext_ok = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| IMAGE_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
            .unwrap_or(false);

        if !ext_ok {
            continue;
        }

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        result.push(ImageFile {
            path: p.to_string_lossy().to_string(),
            name,
            size: meta.len(),
        });
    }

    // Сортируем по имени, чтобы порядок был стабильный
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(result)
}

/// Спрашивает у LMStudio (vision) — в какую из папок отнести картинку
#[tauri::command]
pub async fn organizer_classify_image(
    state: State<'_, AppState>,
    file_path: String,
    user_rules: String,
    folders: Vec<String>,
    model_override: Option<String>,
    temperature_override: Option<f32>,
) -> Result<ClassifyResult, String> {
    if folders.is_empty() {
        return Err("Список папок пуст. Укажите хотя бы одну папку назначения.".into());
    }

    // Параметры берём из общих настроек, но позволяем переопределить
    let (model, temperature) = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        let m = model_override
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| s.lmstudio_model.clone());
        let t = temperature_override.unwrap_or(s.temperature);
        (m, t)
    };

    let raw_bytes = std::fs::read(&file_path)
        .map_err(|e| format!("Не удалось прочитать файл «{}»: {}", file_path, e))?;

    // Пережимаем в JPEG ≤ MAX_IMAGE_SIDE. Если декодирование не удалось
    // (например, HEIC, который image-крейт не умеет) — шлём оригинальные байты,
    // чтобы хотя бы маленькие файлы дошли как раньше.
    let (jpeg_bytes, used_resize) = match prepare_image_jpeg(&raw_bytes, MAX_IMAGE_SIDE) {
        Ok(b) => (b, true),
        Err(e) => {
            println!(
                "[organizer] не удалось пережать «{}»: {} → шлём как есть",
                file_path, e
            );
            (raw_bytes, false)
        }
    };

    let b64 = general_purpose::STANDARD.encode(&jpeg_bytes);
    // ВАЖНО: всегда подписываем как image/jpeg — LMStudio декодирует по бинарному
    // содержимому, а на «честный» MIME (image/webp и т.п.) её парсер ругается
    // ошибкой `'url' field must be a base64 encoded image`.
    // Так уже сделано в `generate_caption` — оставляем единообразно.
    let data_uri = format!("data:image/jpeg;base64,{}", b64);

    println!(
        "[organizer] {} resized={}, payload bytes (jpeg)={}",
        file_path,
        used_resize,
        jpeg_bytes.len()
    );

    let system_prompt = build_system_prompt(&folders, &user_rules);
    let user_text =
        "Проанализируй изображение и выбери одну папку. Верни строго формат <folder>...</folder>."
            .to_string();

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": data_uri}}
            ]}
        ],
        "temperature": temperature,
    });

    let client = state.client.clone();
    println!(
        "[organizer] classify {} (model={}, temperature={}, folders={:?})",
        file_path, model, temperature, folders
    );

    let resp = client
        .post("http://localhost:1234/v1/chat/completions")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ошибка соединения с LMStudio: {}", e))?;

    let status = resp.status();
    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("Ошибка чтения тела ответа LMStudio: {}", e))?;

    println!(
        "[organizer] LMStudio status={} body={}",
        status,
        truncate_for_log(&body_text, 1500)
    );

    if !status.is_success() {
        return Err(format!(
            "LMStudio вернул HTTP {}: {}",
            status,
            truncate_for_log(&body_text, 500)
        ));
    }

    let json: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Не JSON в ответе LMStudio ({}): {}", e, truncate_for_log(&body_text, 500)))?;

    // Иногда модель возвращает «рассуждения» отдельно от content (поле reasoning_content).
    // Берём content + (если пуст) reasoning_content — пригодится тем моделям, что сваливают весь ответ туда.
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let reasoning = json["choices"][0]["message"]["reasoning_content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let raw = if content.trim().is_empty() && !reasoning.trim().is_empty() {
        println!("[organizer] content пустой, используем reasoning_content");
        reasoning
    } else {
        content
    };

    if raw.trim().is_empty() {
        return Err(format!(
            "LMStudio вернула пустой ответ. Полный JSON: {}",
            truncate_for_log(&body_text, 1500)
        ));
    }

    let parsed = parse_folder(&raw, &folders);
    println!(
        "[organizer] raw={} → folder={:?}",
        truncate_for_log(&raw, 500),
        parsed
    );

    Ok(ClassifyResult {
        raw,
        folder: parsed.clone(),
        matched: parsed.is_some(),
    })
}

/// Просит модель LMStudio предложить набор целевых папок исходя из правил пользователя.
/// Это «безмолвная» эмуляция MCP-инструмента: модель обязана вернуть JSON-массив строк,
/// обёрнутый тегом `<folders>…</folders>`.
#[tauri::command]
pub async fn organizer_generate_folders(
    state: State<'_, AppState>,
    user_rules: String,
    existing_folders: Vec<String>,
    model_override: Option<String>,
    temperature_override: Option<f32>,
) -> Result<Vec<String>, String> {
    let trimmed_rules = user_rules.trim();
    if trimmed_rules.is_empty() {
        return Err("Опишите правила классификации, чтобы модель смогла предложить папки.".into());
    }

    let (model, temperature) = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        let m = model_override
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| s.lmstudio_model.clone());
        let t = temperature_override.unwrap_or(s.temperature);
        (m, t)
    };

    let system_prompt = build_folders_system_prompt(&existing_folders, trimmed_rules);
    let user_text = "Сгенерируй список целевых папок согласно правилам. Верни строго формат <folders>[…]</folders>.".to_string();

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "temperature": temperature,
    });

    let client = state.client.clone();
    println!(
        "[organizer] generate folders (model={}, temperature={}, existing={:?})",
        model, temperature, existing_folders
    );

    let resp = client
        .post("http://localhost:1234/v1/chat/completions")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ошибка соединения с LMStudio: {}", e))?;

    let status = resp.status();
    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("Ошибка чтения тела ответа LMStudio: {}", e))?;

    println!(
        "[organizer] generate folders LMStudio status={} body={}",
        status,
        truncate_for_log(&body_text, 1500)
    );

    if !status.is_success() {
        return Err(format!(
            "LMStudio вернул HTTP {}: {}",
            status,
            truncate_for_log(&body_text, 500)
        ));
    }

    let json: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Не JSON в ответе LMStudio ({}): {}", e, truncate_for_log(&body_text, 500)))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let reasoning = json["choices"][0]["message"]["reasoning_content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let raw = if content.trim().is_empty() && !reasoning.trim().is_empty() {
        println!("[organizer] generate folders: content пустой, используем reasoning_content");
        reasoning
    } else {
        content
    };

    if raw.trim().is_empty() {
        return Err(format!(
            "LMStudio вернула пустой ответ. Полный JSON: {}",
            truncate_for_log(&body_text, 1500)
        ));
    }

    let folders = parse_folders(&raw)
        .ok_or_else(|| format!("Не удалось разобрать список папок из ответа модели: {}", truncate_for_log(&raw, 500)))?;

    if folders.is_empty() {
        return Err("Модель вернула пустой список папок.".into());
    }

    println!("[organizer] generated folders: {:?}", folders);
    Ok(folders)
}

/// Перемещает файл в подпапку относительно базовой директории.
/// Если файл с таким именем уже существует — добавляет суффикс `_1`, `_2`, …
/// Возвращает итоговый абсолютный путь.
#[tauri::command]
pub fn organizer_move_file(
    file_path: String,
    base_folder: String,
    sub_folder: String,
) -> Result<String, String> {
    let src = PathBuf::from(&file_path);
    if !src.is_file() {
        return Err(format!("Исходный файл не существует: {}", file_path));
    }

    let safe_sub = sanitize_folder_name(&sub_folder);
    if safe_sub.is_empty() {
        return Err("Имя подпапки оказалось пустым после очистки.".into());
    }

    let dest_dir = PathBuf::from(&base_folder).join(&safe_sub);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Не удалось создать папку «{}»: {}", dest_dir.display(), e))?;

    let file_name = src
        .file_name()
        .ok_or_else(|| "Не удалось получить имя исходного файла".to_string())?;
    let mut dest_path = dest_dir.join(file_name);

    // Если уже есть файл с таким именем — подбираем уникальное
    if dest_path.exists() {
        let stem = src
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file")
            .to_string();
        let ext = src
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| format!(".{}", s))
            .unwrap_or_default();

        let mut idx = 1u32;
        loop {
            let candidate = dest_dir.join(format!("{}_{}{}", stem, idx, ext));
            if !candidate.exists() {
                dest_path = candidate;
                break;
            }
            idx += 1;
            if idx > 9999 {
                return Err("Слишком много дубликатов имени файла".into());
            }
        }
    }

    // rename работает быстро, если оба пути на одном томе. Иначе делаем copy+remove.
    if let Err(e) = std::fs::rename(&src, &dest_path) {
        std::fs::copy(&src, &dest_path)
            .map_err(|e2| format!("Перемещение не удалось ({} / копирование: {})", e, e2))?;
        std::fs::remove_file(&src)
            .map_err(|e3| format!("Не удалось удалить исходный файл после копирования: {}", e3))?;
    }

    Ok(dest_path.to_string_lossy().to_string())
}

// ─────────────────────── Вспомогательные ───────────────────────

/// Декодирует исходные байты картинки, при необходимости уменьшает до `max_side`
/// по большей стороне и перекодирует в JPEG. Возвращает свежие JPEG-байты.
fn prepare_image_jpeg(bytes: &[u8], max_side: u32) -> Result<Vec<u8>, String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("не удалось определить формат: {}", e))?;

    let img = reader
        .decode()
        .map_err(|e| format!("декодирование не удалось: {}", e))?;

    let (w, h) = (img.width(), img.height());
    let max = w.max(h);
    let resized = if max > max_side {
        // Triangle — быстрее Lanczos3 и для классификации картинки разница не важна.
        img.resize(max_side, max_side, FilterType::Triangle)
    } else {
        img
    };

    // Приводим к RGB, чтобы JPEG-энкодер не ругался на альфа/палитру.
    let rgb = resized.to_rgb8();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len() / 4);
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    image::DynamicImage::ImageRgb8(rgb)
        .write_with_encoder(encoder)
        .map_err(|e| format!("кодирование JPEG не удалось: {}", e))?;

    Ok(out)
}

fn truncate_for_log(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max_chars).collect();
    out.push_str("…[truncated]");
    out
}

/// Удаляет недопустимые в имени папки символы Windows/POSIX, схлопывает пробелы.
fn sanitize_folder_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        match ch {
            // Запрещённые символы Windows
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => out.push('_'),
            // Управляющие символы
            c if (c as u32) < 0x20 => {}
            c => out.push(c),
        }
    }
    let trimmed = out.trim().trim_matches('.').to_string();
    trimmed
}

fn build_system_prompt(folders: &[String], user_rules: &str) -> String {
    let folder_list = folders
        .iter()
        .map(|f| format!("- {}", f))
        .collect::<Vec<_>>()
        .join("\n");

    let rules_block = if user_rules.trim().is_empty() {
        "Дополнительных правил нет — опирайся только на содержание изображения и названия папок.".to_string()
    } else {
        format!("Правила пользователя:\n{}", user_rules.trim())
    };

    format!(
        r#"Ты — строгий классификатор изображений. Твоя задача — посмотреть на картинку и выбрать ОДНУ подходящую папку из заранее заданного списка.

ДОСТУПНЫЕ ПАПКИ (выбирай ТОЛЬКО из этого списка, имя пиши БУКВА В БУКВУ):
{folder_list}

{rules_block}

ФОРМАТ ОТВЕТА (обязателен, без отклонений):
<folder>ТОЧНОЕ_ИМЯ_ПАПКИ_ИЗ_СПИСКА</folder>

Жёсткие требования:
1. Никаких объяснений, рассуждений, Markdown, JSON, кавычек, эмодзи — только тег <folder>…</folder>.
2. Имя внутри тега должно совпадать с одним из элементов списка ПОБУКВЕННО (регистр и пробелы сохраняй).
3. Если ни одна папка не подходит — верни <folder>SKIP</folder>.
4. Если сомневаешься — выбирай наиболее вероятную папку, а не SKIP.
5. Запрещено возвращать несколько тегов или несколько имён.
"#
    )
}

/// Достаёт имя папки из ответа модели и сопоставляет его со списком.
/// Возвращает оригинальное имя папки из списка (не нормализованное), либо None,
/// если модель вернула SKIP или не удалось сопоставить.
fn parse_folder(raw: &str, folders: &[String]) -> Option<String> {
    let candidate = extract_folder_tag(raw).unwrap_or_else(|| raw.trim().to_string());
    let candidate_trim = candidate.trim();
    if candidate_trim.is_empty() {
        return None;
    }
    if candidate_trim.eq_ignore_ascii_case("SKIP")
        || candidate_trim.eq_ignore_ascii_case("ПРОПУСТИТЬ")
    {
        return None;
    }

    // 1. Точное совпадение
    if let Some(f) = folders.iter().find(|f| f.as_str() == candidate_trim) {
        return Some(f.clone());
    }

    // 2. Совпадение без учёта регистра
    if let Some(f) = folders
        .iter()
        .find(|f| f.eq_ignore_ascii_case(candidate_trim))
    {
        return Some(f.clone());
    }

    // 3. Нормализованное (без пробелов/знаков, lower)
    let norm_cand = normalize(candidate_trim);
    for f in folders {
        if normalize(f) == norm_cand {
            return Some(f.clone());
        }
    }

    // 4. Подстрока: одно содержит другое
    for f in folders {
        let nf = normalize(f);
        if nf.is_empty() {
            continue;
        }
        if norm_cand.contains(&nf) || nf.contains(&norm_cand) {
            return Some(f.clone());
        }
    }

    None
}

fn build_folders_system_prompt(existing: &[String], user_rules: &str) -> String {
    let existing_block = if existing.is_empty() {
        "Существующих папок ещё нет — список можно собирать с нуля.".to_string()
    } else {
        let lines = existing
            .iter()
            .map(|f| format!("- {}", f))
            .collect::<Vec<_>>()
            .join("\n");
        format!("Уже существующие папки (можешь оставить, заменить или дополнить):\n{}", lines)
    };

    format!(
        r#"Ты — помощник, который придумывает список целевых папок для сортировки фотографий.
На основе правил пользователя предложи короткий, осмысленный набор папок.

{existing_block}

Правила пользователя:
{user_rules}

ФОРМАТ ОТВЕТА (обязателен, без отклонений):
<folders>["Имя1", "Имя2", "Имя3"]</folders>

Жёсткие требования:
1. Внутри тега — только валидный JSON-массив строк, без комментариев и завершающих запятых.
2. От 3 до 10 папок. Имена короткие (1–3 слова), на языке правил пользователя.
3. Не используй запрещённые в именах файлов символы: <>:"/\|?*
4. Не дублируй смысл: каждая папка должна закрывать отдельную категорию.
5. Никаких объяснений, рассуждений, Markdown, кавычек вокруг тега, эмодзи — только тег <folders>…</folders>.
"#
    )
}

fn parse_folders(raw: &str) -> Option<Vec<String>> {
    let payload = extract_folders_tag(raw).unwrap_or_else(|| raw.trim().to_string());
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Сначала пробуем как есть
    if let Some(parsed) = try_parse_json_array(trimmed) {
        return Some(parsed);
    }

    // Иначе ищем первый сбалансированный JSON-массив в строке
    let chars: Vec<char> = trimmed.chars().collect();
    let mut depth = 0i32;
    let mut start: Option<usize> = None;
    for (i, &c) in chars.iter().enumerate() {
        if c == '[' {
            if depth == 0 {
                start = Some(i);
            }
            depth += 1;
        } else if c == ']' {
            depth -= 1;
            if depth == 0 {
                if let Some(s) = start {
                    let slice: String = chars[s..=i].iter().collect();
                    if let Some(parsed) = try_parse_json_array(&slice) {
                        return Some(parsed);
                    }
                }
            }
        }
    }

    None
}

fn try_parse_json_array(slice: &str) -> Option<Vec<String>> {
    let parsed: Vec<serde_json::Value> = serde_json::from_str(slice).ok()?;
    let mut out = Vec::with_capacity(parsed.len());
    let mut seen = std::collections::HashSet::new();
    for v in parsed {
        let s = match v {
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        };
        let cleaned = sanitize_folder_name(s.trim());
        if cleaned.is_empty() {
            continue;
        }
        if seen.insert(cleaned.to_lowercase()) {
            out.push(cleaned);
        }
    }
    Some(out)
}

fn extract_folders_tag(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    let open_tag = "<folders>";
    let close_tag = "</folders>";
    let open_abs = lower.find(open_tag)?;
    let content_start = open_abs + open_tag.len();
    let close_rel = lower[content_start..].find(close_tag)?;
    let close_abs = content_start + close_rel;
    Some(raw[content_start..close_abs].to_string())
}

fn extract_folder_tag(raw: &str) -> Option<String> {
    // Ищем последний <folder>...</folder>, чтобы пропускать раздумья модели,
    // если она их случайно вставила.
    //
    // ВНИМАНИЕ: используем именно `to_ascii_lowercase`, а не `to_lowercase` —
    // первый сохраняет байтовое выравнивание со строкой `raw` (трогает только ASCII),
    // а второй на отдельных юникодных символах меняет длину и ломает срез по байтам.
    let lower = raw.to_ascii_lowercase();
    let open_tag = "<folder>";
    let close_tag = "</folder>";
    let mut search_from = 0usize;
    let mut last: Option<String> = None;

    while let Some(open_rel) = lower[search_from..].find(open_tag) {
        let open_abs = search_from + open_rel;
        let content_start = open_abs + open_tag.len();
        if let Some(close_rel) = lower[content_start..].find(close_tag) {
            let close_abs = content_start + close_rel;
            last = Some(raw[content_start..close_abs].to_string());
            search_from = close_abs + close_tag.len();
        } else {
            break;
        }
    }

    last
}

fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}
