use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};

const WEB_PORT: u16 = 8900;

struct BackendProcess(Arc<Mutex<Option<Child>>>);

fn backend_command(app: &AppHandle) -> (String, Vec<String>) {
    let resource_dir = app.path().resource_dir().unwrap_or_default();
    let bundled = resource_dir.join("prism");
    if bundled.exists() {
        return (bundled.to_string_lossy().to_string(), vec![]);
    }
    (
        "python3".to_string(),
        vec![
            "-m".to_string(), "prism.cli".to_string(),
            "start".to_string(), "--no-open".to_string(),
            "--web-port".to_string(), WEB_PORT.to_string(),
        ],
    )
}

fn start_backend(app: &AppHandle) -> Result<Child, String> {
    let (cmd, args) = backend_command(app);
    println!("[prism] Starting backend: {} {}", cmd, args.join(" "));

    let mut child = Command::new(&cmd)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start backend: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let tx2 = tx.clone();

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if let Ok(text) = line {
                println!("[prism] {}", text);
                if text.contains("Uvicorn running") { let _ = tx.send(true); }
            }
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if let Ok(text) = line {
                println!("[prism] {}", text);
                if text.contains("Uvicorn running") { let _ = tx2.send(true); }
            }
        }
    });

    match rx.recv_timeout(std::time::Duration::from_secs(15)) {
        Ok(_) => Ok(child),
        Err(_) => { let _ = child.kill(); Err("Backend startup timed out".to_string()) }
    }
}

fn kill_backend(app: &AppHandle) {
    if let Some(state) = app.try_state::<BackendProcess>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(ref mut child) = *guard {
                println!("[prism] Stopping backend...");
                let _ = child.kill();
                for _ in 0..50 {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        _ => thread::sleep(std::time::Duration::from_millis(100)),
                    }
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let child = start_backend(&app.handle())?;
            app.manage(BackendProcess(Arc::new(Mutex::new(Some(child)))));

            // Show the window after backend is ready
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            let open = MenuItemBuilder::with_id("open", "Open Prism").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).item(&open).separator().item(&quit).build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Prism HTTP Debugger")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                    "quit" => { kill_backend(app); app.exit(0); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event { let _ = window.hide(); }
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event { kill_backend(app); }
        });
}
