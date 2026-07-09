import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging.js";

/* =========================
   KONFIGURASI FIREBASE
========================= */

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzOgliC5ZYJsGdlbd0AkxuGVWoLK2FkbcFczP2xqX6CSUsgOzZItR9scXIp_lapjJJG/exec";

const PUBLIC_VAPID_KEY = "BDLEfZqsCQ7Kpbux3P0BRdROZuWJL0-qwerFQ7jXRPDKtM5Q5DOOI5T-KGMat1mHcFMONe51JZBcfm5QbV-Huj0";

const firebaseConfig = {
  apiKey: "AIzaSyAT1RFxbpfgl847dYDzGcWM47NmvihGVB8",
  authDomain: "sim-presensi-ibs.firebaseapp.com",
  projectId: "sim-presensi-ibs",
  storageBucket: "sim-presensi-ibs.firebasestorage.app",
  messagingSenderId: "608701531993",
  appId: "1:608701531993:web:750ff0bf6ec8164301ee48",
  measurementId: "G-BG3TVJ963F"
};

const app = initializeApp(firebaseConfig);

let messaging = null;
let serviceWorkerRegistration = null;
let lastFcmRequestPayload = null;

let fcmRegisterRunning = false;
let lastFcmRegisterAt = 0;
const FCM_REGISTER_COOLDOWN_MS = 60 * 1000;

function setStatus(text) {
  const el = document.getElementById("push-status");
  if (el) el.textContent = text;
}

function isStandalonePwa() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function getCurrentUserPayload(extraPayload = {}) {
  const userId =
    extraPayload.userId ||
    document.getElementById("user-id")?.value ||
    localStorage.getItem("sim_user_id") ||
    "anonymous";

  const name =
    extraPayload.name ||
    document.getElementById("user-name")?.value ||
    localStorage.getItem("sim_user_name") ||
    userId;

  return {
    userId: String(userId).trim(),
    name: String(name).trim(),
    role: String(extraPayload.role || "").trim(),
    platform: navigator.platform || "",
    userAgent: navigator.userAgent || ""
  };
}

const SERVICE_WORKER_VERSION =
  String(window.SIM_PWA_VERSION || "20260710-v21").trim();

const SERVICE_WORKER_URL =
  "./sw.js?v=" + encodeURIComponent(SERVICE_WORKER_VERSION);

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Browser ini belum mendukung Service Worker.");
  }

  /*
    Gunakan URL dan versi yang sama dengan index.html.
    Jangan membuat versi khusus FCM seperti presensi-fcm-v3.
  */
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "./",
    updateViaCache: "none"
  });

  /*
    register() belum menjamin worker sudah activated.
    ready menunggu sampai tersedia registration dengan worker aktif.
  */
  const readyRegistration = await navigator.serviceWorker.ready;

  if (!readyRegistration || !readyRegistration.active) {
    throw new Error(
      "Service Worker sudah terdaftar tetapi belum aktif. Silakan buka ulang aplikasi."
    );
  }

  serviceWorkerRegistration = readyRegistration;

  console.log(
    "Service Worker siap untuk FCM:",
    serviceWorkerRegistration.active.scriptURL
  );

  return serviceWorkerRegistration;
}

async function sendTokenToGas(token, userPayload) {
  const payload = {
    action: "save_fcm_token",
    token,
    ...userPayload
  };

  const body = JSON.stringify(payload);

  try {
    await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      mode: "no-cors",
      redirect: "follow",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body
    });

    return {
      success: true,
      message: "Token FCM dikirim ke backend.",
      opaque: true
    };
  } catch (err) {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], {
        type: "text/plain;charset=utf-8"
      });

      const sent = navigator.sendBeacon(GAS_WEB_APP_URL, blob);

      if (sent) {
        return {
          success: true,
          message: "Token FCM dikirim via sendBeacon.",
          opaque: true
        };
      }
    }

    throw err;
  }
}

/*
  Fungsi ini WAJIB dipanggil dari klik/tap user.
  Jangan dipanggil otomatis saat halaman load.
*/
export async function enablePushNotification(extraPayload = {}) {
  try {
    setStatus("Memeriksa dukungan browser...");

    const supported = await isSupported();
    if (!supported) {
      throw new Error("Firebase Messaging belum didukung di browser ini.");
    }

    if (!("Notification" in window)) {
      throw new Error("Browser ini belum mendukung Notification API.");
    }

    setStatus("Meminta izin notifikasi...");
    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      throw new Error("Izin notifikasi tidak diberikan oleh user.");
    }

    const swReg = await ensureServiceWorker();

    messaging = getMessaging(app);

    setStatus("Mengambil token FCM browser...");
    const token = await getToken(messaging, {
      vapidKey: PUBLIC_VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (!token) {
      throw new Error("Token FCM tidak berhasil dibuat.");
    }

    const userPayload = getCurrentUserPayload(extraPayload);

    setStatus("Menyimpan token ke Google Sheets...");
    const saveResult = await sendTokenToGas(token, userPayload);

    if (!saveResult.success) {
      throw new Error(saveResult.message || "Token gagal disimpan ke backend.");
    }

    localStorage.setItem("sim_fcm_token", token);
    localStorage.setItem("sim_user_id", userPayload.userId);
    localStorage.setItem("sim_user_name", userPayload.name);
    localStorage.setItem("sim_fcm_permission_done", "1");

    setStatus(
      "Notifikasi aktif.\n" +
      "User: " + userPayload.name + "\n" +
      "Token tersimpan di Google Sheets."
    );

    return {
      success: true,
      token
    };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);

    setStatus("Gagal mengaktifkan notifikasi: " + message);

    return {
      success: false,
      message
    };
  }
}

/*
  Auto-register token jika user sebelumnya menolak,
  lalu di kemudian hari mengaktifkan izin notifikasi dari pengaturan HP/browser.

  Fungsi ini tidak meminta izin ulang.
  Fungsi ini hanya berjalan kalau Notification.permission sudah "granted".
*/
async function autoRegisterFcmTokenIfPermissionGranted(extraPayload = {}) {
  if (fcmRegisterRunning) return;

  const now = Date.now();
  if (now - lastFcmRegisterAt < FCM_REGISTER_COOLDOWN_MS) return;

  fcmRegisterRunning = true;

/*
  Jangan isi lastFcmRegisterAt di sini.
  Waktu cooldown hanya disimpan setelah token benar-benar berhasil.
*/

  try {
    if (!("Notification" in window)) return;

    if (Notification.permission !== "granted") return;

    const supported = await isSupported();
    if (!supported) return;

    const swReg = await ensureServiceWorker();

    messaging = getMessaging(app);

    const token = await getToken(messaging, {
      vapidKey: PUBLIC_VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (!token) return;

    const userPayload = getCurrentUserPayload(extraPayload);

    const saveResult = await sendTokenToGas(token, userPayload);

    if (saveResult && saveResult.success) {
      lastFcmRegisterAt = Date.now();
      localStorage.setItem("sim_fcm_token", token);
      localStorage.setItem("sim_user_id", userPayload.userId);
      localStorage.setItem("sim_user_name", userPayload.name);
      localStorage.setItem("sim_fcm_permission_done", "1");
      localStorage.setItem("sim_fcm_registered_at", new Date().toISOString());

      console.log("FCM token aktif dan dikirim:", saveResult);
    } else {
      console.warn("FCM token gagal dikirim:", saveResult);
    }
 } catch (err) {
  /*
    Izinkan percobaan ulang segera apabila proses sebelumnya gagal.
  */
  lastFcmRegisterAt = 0;

  console.warn("Auto register FCM gagal:", err);
} finally {
  fcmRegisterRunning = false;
}
}

function removeFcmPromptOverlay() {
  const old = document.getElementById("sim-fcm-permission-overlay");
  if (old) old.remove();
}

function showFcmPromptOverlay(payload = {}) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") return;

  removeFcmPromptOverlay();

  lastFcmRequestPayload = payload || {};

  const overlay = document.createElement("div");
  overlay.id = "sim-fcm-permission-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    box-sizing: border-box;
  `;

  overlay.innerHTML = `
    <div style="
      width: 100%;
      max-width: 420px;
      background: #ffffff;
      color: #111827;
      border-radius: 22px;
      box-shadow: 0 24px 70px rgba(0,0,0,0.28);
      padding: 24px;
      font-family: Arial, sans-serif;
      text-align: center;
    ">
      <div style="
        width: 58px;
        height: 58px;
        margin: 0 auto 14px;
        border-radius: 18px;
        background: #dcfce7;
        color: #15803d;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
      ">🔔</div>

      <h2 style="margin: 0 0 10px; font-size: 22px;">
        Aktifkan Notifikasi
      </h2>

      <p style="margin: 0 0 18px; color: #4b5563; line-height: 1.6; font-size: 15px;">
        Agar SIM Murojaah dapat mengirim pemberitahuan penting,
        silakan aktifkan notifikasi pada perangkat ini.
      </p>

      <button id="sim-fcm-allow-btn" type="button" style="
        width: 100%;
        border: 0;
        border-radius: 999px;
        padding: 13px 18px;
        background: #15803d;
        color: #ffffff;
        font-weight: 700;
        font-size: 15px;
        cursor: pointer;
      ">
        Izinkan Notifikasi
      </button>

      <button id="sim-fcm-later-btn" type="button" style="
        margin-top: 10px;
        width: 100%;
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        background: #f3f4f6;
        color: #374151;
        font-weight: 700;
        font-size: 14px;
        cursor: pointer;
      ">
        Nanti Saja
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("sim-fcm-allow-btn").addEventListener("click", async function () {
    const btn = this;
    btn.disabled = true;
    btn.textContent = "Mengaktifkan...";

    const result = await enablePushNotification(lastFcmRequestPayload || {});

    if (result.success) {
      removeFcmPromptOverlay();

      const iframe = document.getElementById("app");
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: "SIM_FCM_ENABLE_RESULT",
          success: true,
          token: result.token
        }, "*");
      }
    } else {
      btn.disabled = false;
      btn.textContent = "Coba Lagi";
      alert(result.message || "Notifikasi gagal diaktifkan.");
    }
  });

 document.getElementById("sim-fcm-later-btn").addEventListener("click", function () {
  /*
    Jangan pakai localStorage di sini.
    Kalau pakai localStorage, popup tidak akan muncul lagi di pembukaan berikutnya.
    Dengan sessionStorage, popup hanya tidak muncul ulang pada sesi buka aplikasi saat ini.
  */
  sessionStorage.setItem("sim_fcm_prompt_shown_this_open", "1");
  removeFcmPromptOverlay();
});
}

/*
  Tombol manual jika suatu saat dipakai langsung di parent page.
*/
window.enablePushFromButton = function () {
  showFcmPromptOverlay();
};

/*
  Foreground notification: saat tab sedang terbuka.
*/
async function installForegroundListener() {
  try {
    const supported = await isSupported();
    if (!supported) return;

    messaging = getMessaging(app);

    onMessage(messaging, function (payload) {
      const title =
        payload?.notification?.title ||
        payload?.data?.title ||
        "Notifikasi";

      const body =
        payload?.notification?.body ||
        payload?.data?.body ||
        "";

      const url =
        payload?.data?.url ||
        payload?.fcmOptions?.link ||
        "./";

      if (Notification.permission === "granted") {
        new Notification(title, {
          body,
          icon: "./icon-192.png",
          data: { url }
        });
      }
    });
  } catch (err) {
    console.warn("Foreground listener gagal:", err);
  }
}

installForegroundListener();

/*
  Bridge dari iframe GAS.
  Penting:
  Jangan langsung Notification.requestPermission() dari event postMessage,
  karena browser sering tidak menganggap itu sebagai user gesture.
  Jadi parent menampilkan overlay, lalu user klik tombol di parent.
*/
window.addEventListener("message", function (event) {
  const data = event.data || {};

  if (data.type !== "SIM_FCM_ENABLE_REQUEST") return;

  showFcmPromptOverlay(data.payload || {});
});

/*
  Setelah PWA pertama kali di-install / dibuka standalone,
  tampilkan overlay sendiri. Tetap butuh klik user.
*/
window.addEventListener("appinstalled", function () {
  localStorage.setItem("sim_pwa_installed", "1");

  setTimeout(function () {
    if (Notification.permission === "default") {
      showFcmPromptOverlay();
    }
  }, 800);
});

function shouldShowFcmPromptEveryOpen() {
  if (!("Notification" in window)) return false;

  // Kalau sudah granted, jangan tampilkan popup lagi.
  if (Notification.permission === "granted") return false;

  // Kalau user sudah memilih Block/Deny, browser tidak akan menampilkan prompt izin lagi.
  // Nanti kita tampilkan popup instruksi khusus.
  if (Notification.permission === "denied") return true;

  // Kalau masih default, artinya belum pernah diberi izin.
  return Notification.permission === "default";
}

function openNotificationSettingsBestEffort() {
  /*
    Browser/PWA tidak selalu boleh membuka pengaturan notifikasi secara langsung.
    Kode ini mencoba beberapa jalur umum di Android/Chrome.
    Jika gagal, user tetap diberi panduan manual.
  */

  const isAndroid = /Android/i.test(navigator.userAgent || "");

  if (isAndroid) {
    try {
      // Percobaan membuka pengaturan notifikasi Android.
      window.location.href =
        "intent://settings/#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;end";
      return;
    } catch (err) {
      console.warn("Gagal membuka Android notification settings:", err);
    }

    try {
      // Fallback ke pengaturan aplikasi Android.
      window.location.href =
        "intent://settings/#Intent;action=android.settings.APPLICATION_SETTINGS;end";
      return;
    } catch (err) {
      console.warn("Gagal membuka Android app settings:", err);
    }
  }

  showFcmSettingsGuide();
}

function showFcmSettingsGuide() {
  const help = document.getElementById("sim-fcm-denied-help");
  if (help) {
    help.style.display = "block";
  }

  alert(
    "Jika pengaturan tidak terbuka otomatis, buka manual:\n\n" +
    "1. Tekan dan tahan ikon aplikasi SIM Murojaah.\n" +
    "2. Pilih Info Aplikasi / App Info.\n" +
    "3. Buka Notifikasi / Notifications.\n" +
    "4. Aktifkan izin notifikasi.\n" +
    "5. Tutup lalu buka ulang aplikasi."
  );
}

function showFcmDeniedInstructionOverlay() {
  removeFcmPromptOverlay();

  const overlay = document.createElement("div");
  overlay.id = "sim-fcm-permission-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    box-sizing: border-box;
  `;

  overlay.innerHTML = `
    <div style="
      width: 100%;
      max-width: 420px;
      background: #ffffff;
      color: #111827;
      border-radius: 22px;
      box-shadow: 0 24px 70px rgba(0,0,0,0.28);
      padding: 24px;
      font-family: Arial, sans-serif;
      text-align: center;
    ">
      <div style="
        width: 58px;
        height: 58px;
        margin: 0 auto 14px;
        border-radius: 18px;
        background: #fee2e2;
        color: #dc2626;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
      ">🔕</div>

      <h2 style="margin: 0 0 10px; font-size: 22px;">
        Notifikasi Diblokir
      </h2>

      <p style="margin: 0 0 18px; color: #4b5563; line-height: 1.6; font-size: 15px;">
        Izin notifikasi untuk aplikasi ini sedang diblokir.
        Buka pengaturan notifikasi, lalu ubah izin menjadi Allow/Izinkan.
      </p>

      <button id="sim-fcm-open-settings-btn" type="button" style="
        width: 100%;
        border: 0;
        border-radius: 999px;
        padding: 13px 18px;
        background: #15803d;
        color: #ffffff;
        font-weight: 700;
        font-size: 15px;
        cursor: pointer;
      ">
        Buka Pengaturan Notifikasi
      </button>

      <button id="sim-fcm-check-again-btn" type="button" style="
        margin-top: 10px;
        width: 100%;
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        background: #ecfdf5;
        color: #166534;
        font-weight: 700;
        font-size: 14px;
        cursor: pointer;
      ">
        Saya Sudah Mengaktifkan
      </button>

      <button id="sim-fcm-guide-btn" type="button" style="
        margin-top: 10px;
        width: 100%;
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        background: #f3f4f6;
        color: #374151;
        font-weight: 700;
        font-size: 14px;
        cursor: pointer;
      ">
        Lihat Panduan Manual
      </button>

      <button id="sim-fcm-denied-close-btn" type="button" style="
        margin-top: 10px;
        width: 100%;
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        background: transparent;
        color: #6b7280;
        font-weight: 700;
        font-size: 14px;
        cursor: pointer;
      ">
        Nanti Saja
      </button>

      <div id="sim-fcm-denied-help" style="
        display: none;
        margin-top: 16px;
        padding: 14px;
        border-radius: 16px;
        background: #f9fafb;
        color: #374151;
        text-align: left;
        font-size: 14px;
        line-height: 1.6;
      ">
        <b>Cara membuka blokir notifikasi:</b><br>
        1. Tekan dan tahan ikon aplikasi SIM Murojaah di layar HP.<br>
        2. Pilih <b>Info Aplikasi</b> / <b>App Info</b>.<br>
        3. Masuk ke <b>Notifikasi</b> / <b>Notifications</b>.<br>
        4. Aktifkan izin notifikasi.<br>
        5. Tutup aplikasi, lalu buka kembali.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("sim-fcm-open-settings-btn").addEventListener("click", function () {
    openNotificationSettingsBestEffort();
  });

  document.getElementById("sim-fcm-guide-btn").addEventListener("click", function () {
    const help = document.getElementById("sim-fcm-denied-help");
    if (help) {
      help.style.display = help.style.display === "none" ? "block" : "none";
    }
  });

  document.getElementById("sim-fcm-check-again-btn").addEventListener("click", async function () {
  const btn = this;
  btn.disabled = true;
  btn.textContent = "Memeriksa...";

  try {
    if (!("Notification" in window)) {
      alert("Browser ini belum mendukung notifikasi.");
      btn.disabled = false;
      btn.textContent = "Saya Sudah Mengaktifkan";
      return;
    }

    if (Notification.permission === "granted") {
      await autoRegisterFcmTokenIfPermissionGranted(lastFcmRequestPayload || {});

      const savedToken = localStorage.getItem("sim_fcm_token") || "";

      if (savedToken) {
        removeFcmPromptOverlay();
        alert("Notifikasi berhasil diaktifkan dan token sudah terdaftar.");
        return;
      }

      alert("Izin sudah aktif, tetapi token belum berhasil dibuat. Tutup dan buka ulang aplikasi.");
    } else if (Notification.permission === "denied") {
      showFcmSettingsGuide();
    } else {
      removeFcmPromptOverlay();
      showFcmPromptOverlay(lastFcmRequestPayload || {});
    }
  } catch (err) {
    alert(err && err.message ? err.message : String(err));
  }

  btn.disabled = false;
  btn.textContent = "Saya Sudah Mengaktifkan";
});

  document.getElementById("sim-fcm-denied-close-btn").addEventListener("click", function () {
    sessionStorage.setItem("sim_fcm_prompt_shown_this_open", "1");
    removeFcmPromptOverlay();
  });
}

function scheduleFcmPromptEveryOpen() {
  setTimeout(async function () {
    if (!("Notification" in window)) return;

    /*
      Jika user sudah mengaktifkan notifikasi lewat pengaturan HP/browser,
      langsung buat token dan simpan ke Google Sheets.
    */
    if (Notification.permission === "granted") {
      await autoRegisterFcmTokenIfPermissionGranted(lastFcmRequestPayload || {});
      return;
    }

    /*
      Jika masih denied, tampilkan popup info/pengaturan.
      Jika masih default, tampilkan popup aktifkan notifikasi.
    */
    if (!shouldShowFcmPromptEveryOpen()) return;

    if (sessionStorage.getItem("sim_fcm_prompt_shown_this_open") === "1") return;

    sessionStorage.setItem("sim_fcm_prompt_shown_this_open", "1");

    if (Notification.permission === "denied") {
      showFcmDeniedInstructionOverlay();
      return;
    }

    showFcmPromptOverlay();
  }, 1500);
}

document.addEventListener("DOMContentLoaded", function () {
  scheduleFcmPromptEveryOpen();
});

window.addEventListener("pageshow", function () {
  scheduleFcmPromptEveryOpen();
});

/*
  Saat user balik dari pengaturan HP/browser ke aplikasi,
  sistem cek lagi apakah izin sudah berubah menjadi granted.
*/
window.addEventListener("focus", function () {
  autoRegisterFcmTokenIfPermissionGranted(lastFcmRequestPayload || {});
});

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") {
    autoRegisterFcmTokenIfPermissionGranted(lastFcmRequestPayload || {});
  }
});

/* =========================================================
   FCM BOOT FALLBACK - SIM PRESENSI
   Memastikan popup buatan muncul saat aplikasi dibuka
========================================================= */

window.__SIM_PRESENSI_FCM_APPJS_LOADED = true;
console.log("SIM Presensi FCM app.js aktif");

function forceCheckFcmPermissionOnOpen() {
  setTimeout(async function () {
    try {
      if (!("Notification" in window)) {
        console.warn("Notification API tidak tersedia.");
        return;
      }

      console.log("Status izin notifikasi:", Notification.permission);

      if (Notification.permission === "granted") {
        await autoRegisterFcmTokenIfPermissionGranted(lastFcmRequestPayload || {});
        return;
      }

      if (sessionStorage.getItem("sim_fcm_prompt_shown_this_open") === "1") {
        return;
      }

      sessionStorage.setItem("sim_fcm_prompt_shown_this_open", "1");

      if (Notification.permission === "denied") {
        showFcmDeniedInstructionOverlay();
        return;
      }

      if (Notification.permission === "default") {
        showFcmPromptOverlay(lastFcmRequestPayload || {});
      }
    } catch (err) {
      console.warn("FCM boot fallback gagal:", err);
    }
  }, 2500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", forceCheckFcmPermissionOnOpen);
} else {
  forceCheckFcmPermissionOnOpen();
}

window.addEventListener("load", forceCheckFcmPermissionOnOpen);
