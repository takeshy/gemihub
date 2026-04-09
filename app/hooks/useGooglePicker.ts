import { useCallback, useRef } from "react";

declare global {
  interface Window {
    gapi?: {
      load: (api: string, callback: () => void) => void;
    };
    google?: {
      picker?: {
        PickerBuilder: new () => GooglePickerBuilder;
        DocsView: new (viewId: string) => GooglePickerView;
        ViewId: { SPREADSHEETS: string };
        Action: { PICKED: string; CANCEL: string };
        Document: { ID: string; NAME: string; URL: string };
      };
    };
  }
}

interface GooglePickerView {
  setMimeTypes: (mimeTypes: string) => GooglePickerView;
}

interface GooglePickerBuilder {
  addView: (view: GooglePickerView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setCallback: (callback: (data: GooglePickerCallbackData) => void) => GooglePickerBuilder;
  setTitle: (title: string) => GooglePickerBuilder;
  setLocale: (locale: string) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}

interface GooglePickerCallbackData {
  action: string;
  docs?: Array<{
    [key: string]: string;
  }>;
}

export interface PickedSpreadsheet {
  id: string;
  name: string;
  url: string;
}

const PICKER_API_URL = "https://apis.google.com/js/api.js";

let pickerApiLoaded = false;
let pickerApiLoading: Promise<void> | null = null;

function loadPickerApi(): Promise<void> {
  if (pickerApiLoaded) return Promise.resolve();
  if (pickerApiLoading) return pickerApiLoading;

  pickerApiLoading = new Promise<void>((resolve, reject) => {
    // Check if script is already in DOM
    if (document.querySelector(`script[src="${PICKER_API_URL}"]`)) {
      if (window.gapi) {
        window.gapi.load("picker", () => {
          pickerApiLoaded = true;
          resolve();
        });
      } else {
        reject(new Error("gapi script loaded but gapi not available"));
      }
      return;
    }

    const script = document.createElement("script");
    script.src = PICKER_API_URL;
    script.async = true;
    script.onload = () => {
      window.gapi!.load("picker", () => {
        pickerApiLoaded = true;
        resolve();
      });
    };
    script.onerror = () => reject(new Error("Failed to load Google Picker API"));
    document.head.appendChild(script);
  });

  return pickerApiLoading;
}

async function fetchPickerToken(): Promise<string> {
  const res = await fetch("/api/auth/picker-token");
  if (!res.ok) throw new Error("Failed to get picker token");
  const data = await res.json();
  return data.accessToken;
}

/**
 * Hook for opening a Google Picker to select a spreadsheet.
 * Uses the drive.file scope — selected files become accessible to the app.
 */
export function useGooglePicker() {
  const openingRef = useRef(false);

  const openSpreadsheetPicker = useCallback(
    (options?: { locale?: string; title?: string }): Promise<PickedSpreadsheet | null> => {
      if (openingRef.current) return Promise.resolve(null);
      openingRef.current = true;

      return (async () => {
        try {
          const [accessToken] = await Promise.all([fetchPickerToken(), loadPickerApi()]);

          const google = window.google?.picker;
          if (!google) throw new Error("Google Picker API not available");

          return new Promise<PickedSpreadsheet | null>((resolve) => {
            const view = new google.DocsView(google.ViewId.SPREADSHEETS);

            const builder = new google.PickerBuilder()
              .addView(view)
              .setOAuthToken(accessToken)
              .setTitle(options?.title || "Select Spreadsheet")
              .setCallback((data: GooglePickerCallbackData) => {
                if (data.action === google.Action.PICKED && data.docs?.[0]) {
                  const doc = data.docs[0];
                  resolve({
                    id: doc[google.Document.ID],
                    name: doc[google.Document.NAME],
                    url: doc[google.Document.URL],
                  });
                } else if (data.action === google.Action.CANCEL) {
                  resolve(null);
                }
              });

            if (options?.locale) {
              builder.setLocale(options.locale);
            }

            builder.build().setVisible(true);
          });
        } finally {
          openingRef.current = false;
        }
      })();
    },
    []
  );

  return { openSpreadsheetPicker };
}
