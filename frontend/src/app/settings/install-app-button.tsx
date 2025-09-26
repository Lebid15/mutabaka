"use client";

import { useEffect, useState, useCallback } from "react";
import { useThemeMode } from "../theme-context";

const LIGHT_BUTTON_CLASS = "w-full md:w-auto px-3 py-2 rounded-lg text-sm font-semibold transition shadow-sm border border-[#bde5d1] bg-[#2f9d73] hover:bg-[#258660] text-white";
const DARK_BUTTON_CLASS = "w-full md:w-auto px-3 py-2 rounded-lg text-sm font-semibold transition shadow-sm border border-green-500/40 bg-emerald-600 hover:bg-emerald-500 text-white";

export default function InstallAppButton() {
  const { isLight } = useThemeMode();
  const [support, setSupport] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<any>(null);
  const [manualOnly, setManualOnly] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const canPrompt = "onbeforeinstallprompt" in window;
    setSupport(canPrompt);
    if (!canPrompt) {
      setManualOnly(true);
    }

    const standaloneMedia = window.matchMedia("(display-mode: standalone)");
    const isStandalone = standaloneMedia.matches || (window.navigator as any).standalone === true;
    setInstalled(isStandalone);

    const handleStandaloneChange = (event: MediaQueryListEvent | { matches: boolean }) => {
      setInstalled(event.matches);
    };

    const handleBeforeInstallPrompt = (event: any) => {
      event.preventDefault();
      setDeferred(event);
      setSupport(true);
      setManualOnly(false);
    };

    const handleAppInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setSupport(false);
      setManualOnly(false);
    };

    if (typeof standaloneMedia.addEventListener === "function") {
      standaloneMedia.addEventListener("change", handleStandaloneChange as any);
    } else if (typeof (standaloneMedia as any).addListener === "function") {
      (standaloneMedia as any).addListener(handleStandaloneChange);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      if (typeof standaloneMedia.removeEventListener === "function") {
        standaloneMedia.removeEventListener("change", handleStandaloneChange as any);
      } else if (typeof (standaloneMedia as any).removeListener === "function") {
        (standaloneMedia as any).removeListener(handleStandaloneChange);
      }
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (deferred) {
      try {
        deferred.prompt();
        await deferred.userChoice;
      } catch (error) {
        console.error(error);
      } finally {
        setDeferred(null);
      }
    } else {
      setManualOnly(true);
      alert(
        "إن لم يظهر زر تثبيت:\n- على Android: من قائمة المتصفح ⋮ اختر Add to Home screen.\n- على iOS (Safari): Share → Add to Home Screen."
      );
    }
  }, [deferred]);

  if (installed) return null;

  return (
    <div className="flex flex-col gap-2">
      <button
        id="installBtn"
        onClick={handleClick}
        className={isLight ? LIGHT_BUTTON_CLASS : DARK_BUTTON_CLASS}
      >
        تثبيت التطبيق
        {!support && " (إرشادات)"}
      </button>
      {manualOnly && (
        <p className={isLight ? "text-xs text-[#7f6958]" : "text-xs text-gray-400"}>
          إن لم يظهر مربع التثبيت تلقائياً: على Android افتح قائمة ⋮ ثم اختر "Add to Home screen"،
          وعلى iOS (Safari) استخدم مشاركة → "Add to Home Screen".
        </p>
      )}
    </div>
  );
}
