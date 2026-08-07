use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const WEB_PORT: u16 = 8900;

struct BackendProcess(Arc<Mutex<Option<Child>>>);

fn backend_command(app: &AppHandle) -> (String, Vec<String>) {
    let resource_dir = app.path().resource_dir().unwrap_or_default();
    let bundled = resource_dir.join("binaries").join("prism");
    if bundled.exists() {
        return (bundled.to_string_lossy().to_string(), vec!["start".to_string(), "--no-open".to_string()]);
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

    let _ = Command::new("lsof").args(["-ti", &format!(":{}", WEB_PORT)])
        .output().ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|pids| {
            for pid in pids.lines() {
                let _ = Command::new("kill").arg("-9").arg(pid).output();
            }
        });

    let mut child = Command::new(&cmd)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONUNBUFFERED", "1")
        .spawn()
        .map_err(|e| format!("Failed to start backend: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if let Ok(text) = line { println!("[prism] {}", text); }
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if let Ok(text) = line { println!("[prism] {}", text); }
        }
    });

    let addr = format!("127.0.0.1:{}", WEB_PORT);
    for i in 0..120 {
        thread::sleep(Duration::from_millis(500));
        if std::net::TcpStream::connect(&addr).is_ok() {
            println!("[prism] Backend ready after {}s", i / 2);
            return Ok(child);
        }
    }
    let _ = child.kill();
    Err(format!("Backend startup timed out (60s)"))
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
                        _ => thread::sleep(Duration::from_millis(100)),
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
            let handle = app.handle().clone();

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

            // Spawn backend then create window when ready
            thread::spawn(move || {
                match start_backend(&handle) {
                    Ok(child) => { handle.manage(BackendProcess(Arc::new(Mutex::new(Some(child))))); }
                    Err(e) => eprintln!("[prism] {}", e),
                }
                // Backend ready — create window loading from localhost
                let window = WebviewWindowBuilder::new(
                    &handle, "main",
                    WebviewUrl::External(format!("http://localhost:{}", WEB_PORT).parse().unwrap()),
                )
                .title("Prism HTTP Debugger")
                .inner_size(1280.0, 860.0)
                .center()
                .build()
                .unwrap();
                let _ = window.show();
            });

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
