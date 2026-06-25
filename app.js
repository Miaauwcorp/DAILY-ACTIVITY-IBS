import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging.js";

/* =========================================================
   KONFIGURASI FIREBASE - SIM PRESENSI IBS
   Jika memakai Firebase project yang sama dengan Murojaah,
   config di bawah boleh sama. Jika memakai project baru,
   ganti semuanya dari Firebase Console.
========================================================= */

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
    extraPayload.username ||
    localStorage.getItem("presensi_user_id") ||
    localStorage.getItem("sim_user_id") ||
    "anonymous";

  const name =
    extraPayload.name ||
    extraPayload.nama ||
    localStorage.getItem("presensi_user_name") ||
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

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Browser ini belum mendukung Service Worker.");
  }

  if (!serviceWorkerRegistration) {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./sw.js");
  }

  return serviceWorkerRegistration;
}

async function sendTokenToGas(token, userPayload) {
  const payload = {
    action: "save_fcm_token",
    token: token,
    ...userPayload
  };

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch (err) {
    return {
      success: response.ok,
      raw: text
    };
  }
}

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

    localStorage.setItem("presensi_fcm_token", token);
    localStorage.setItem("presensi_user_id", userPayload.userId);
    localStorage.setItem("presensi_user_name", userPayload.name);
    localStorage.setItem("presensi_fcm_permission_done", "1");
    localStorage.setItem("presensi_fcm_registered_at", new Date().toISOString());

    setStatus(
      "Notifikasi aktif.\n" +
      "User: " + userPayload.name + "\n" +
      "Token tersimpan di Google Sheets."
    );

    return {
      success: true,
      token: token
    };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    setStatus("Gagal mengaktifkan notifikasi: " + message);

    return {
      success: false,
      message: message
    };
  }
}

/*
  Auto-register token jika user dulu menolak notifikasi,
  lalu kemudian mengaktifkan notifikasi dari pengaturan HP/browser.
*/
async function autoRegisterFcmTokenIfPermissionGranted(extraPayload = {}) {
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
      localStorage.setItem("presensi_fcm_token", token);
      localStorage.setItem("presensi_user_id", userPayload.userId);
      localStorage.setItem("presensi_user_name", userPayload.name);
      localStorage.setItem("presensi_fcm_permission_done", "1");
      localStorage.setItem("presensi_fcm_registered_at", new Date().toISOString());

      console.log("FCM Presensi token aktif dan tersimpan:", saveResult);
    } else {
      console.warn("FCM Presensi token gagal disimpan:", saveResult);
    }
  } catch (err) {
    console.warn("Auto register FCM Presensi gagal:", err);
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
        Agar SIM Presensi dapat mengirim pemberitahuan penting,
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

      return;
    }

    btn.disabled = false;
    btn.textContent = "Coba Lagi";
    alert(result.message || "Notifikasi gagal diaktifkan.");
  });

  document.getElementById("sim-fcm-later-btn").addEventListener("click", function () {
    sessionStorage.setItem("presensi_fcm_prompt_shown_this_open", "1");
    removeFcmPromptOverlay();
  });
}

function showFcmSettingsGuide() {
  const help = document.getElementById("sim-fcm-denied-help");
  if (help) help.style.display = "block";

  alert(
    "Jika pengaturan tidak terbuka otomatis, buka manual:\n\n" +
    "1. Tekan dan tahan ikon aplikasi SIM Presensi.\n" +
    "2. Pilih Info Aplikasi / App Info.\n" +
    "3. Buka Notifikasi / Notifications.\n" +
    "4. Aktifkan izin notifikasi.\n" +
    "5. Tutup lalu buka ulang aplikasi."
  );
}

function openNotificationSettingsBestEffort() {
  const isAndroid = /Android/i.test(navigator.userAgent || "");

  if (isAndroid) {
    try {
      window.location.href =
        "intent://settings/#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;end";
      return;
    } catch (err) {
      console.warn("Gagal membuka Android notification settings:", err);
    }

    try {
      window.location.href =
        "intent://settings/#Intent;action=android.settings.APPLICATION_SETTINGS;end";
      return;
    } catch (err) {
      console.warn("Gagal membuka Android app settings:", err);
    }
  }

  showFcmSettingsGuide();
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
        1. Tekan dan tahan ikon aplikasi SIM Presensi di layar HP.<br>
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
    if (help) help.style.display = help.style.display === "none" ? "block" : "none";
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
        const savedToken = localStorage.getItem("presensi_fcm_token") || "";

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
    sessionStorage.setItem("presensi_fcm_prompt_shown_this_open", "1");
    removeFcmPromptOverlay();
  });
}

function shouldShowFcmPromptEveryOpen() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return false;
  if (Notification.permission === "denied") return true;
  return Notification.permission === "default";
}

function scheduleFcmPromptEveryOpen() {
  setTimeout(async function () {
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      await autoRegisterFcmTokenIfPermissionGranted(lastFcmRequestPayload || {});
      return;
    }

    if (!shouldShowFcmPromptEveryOpen()) return;
    if (sessionStorage.getItem("presensi_fcm_prompt_shown_this_open") === "1") return;

    sessionStorage.setItem("presensi_fcm_prompt_shown_this_open", "1");

    if (Notification.permission === "denied") {
      showFcmDeniedInstructionOverlay();
      return;
    }

    showFcmPromptOverlay();
  }, 1500);
}

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
          body: body,
          icon: "./icon-192.png",
          data: { url: url }
        });
      }
    });
  } catch (err) {
    console.warn("Foreground listener gagal:", err);
  }
}

installForegroundListener();

window.enablePushFromButton = function () {
  showFcmPromptOverlay();
};

window.addEventListener("message", function (event) {
  const data = event.data || {};

  if (data.type !== "SIM_FCM_ENABLE_REQUEST") return;

  showFcmPromptOverlay(data.payload || {});
});

window.addEventListener("appinstalled", function () {
  localStorage.setItem("presensi_pwa_installed", "1");

  setTimeout(function () {
    if (Notification.permission === "default") {
      showFcmPromptOverlay();
    }
  }, 800);
});

document.addEventListener("DOMContentLoaded", function () {
  scheduleFcmPromptEveryOpen();
});

window.addEventListener("pageshow", function () {
  scheduleFcmPromptEveryOpen();
});

window.addEventListener("focus", function () {
  autoRegisterFcmTokenIfPermissionGranted(lastFcmRequestPayload || {});
});

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") {
    autoRegisterFcmTokenIfPermissionGranted(lastFcmRequestPayload || {});
  }
});
