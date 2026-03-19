/** Ambient types for Google Picker API and Google Identity Services (GIS) */

interface Window {
  gapi: {
    load(api: string, callbacks: { callback: () => void; onerror: () => void }): void;
  };
}

declare namespace google {
  namespace picker {
    class PickerBuilder {
      setOAuthToken(token: string): PickerBuilder;
      addView(view: DocsView): PickerBuilder;
      setCallback(callback: (data: PickerResponse) => void): PickerBuilder;
      setTitle(title: string): PickerBuilder;
      setOrigin(origin: string): PickerBuilder;
      build(): Picker;
    }

    class DocsView {
      constructor(viewId?: ViewId);
      setMimeTypes(mimeTypes: string): DocsView;
      setMode(mode: DocsViewMode): DocsView;
    }

    interface Picker {
      setVisible(visible: boolean): void;
      dispose(): void;
    }

    interface PickerResponse {
      [Response.ACTION]: Action;
      [Response.DOCUMENTS]?: PickerDocument[];
    }

    interface PickerDocument {
      [Document.ID]: string;
      [Document.NAME]: string;
      [Document.URL]: string;
      [Document.MIME_TYPE]: string;
    }

    enum Action {
      PICKED = 'picked',
      CANCEL = 'cancel',
    }

    enum Response {
      ACTION = 'action',
      DOCUMENTS = 'docs',
    }

    enum Document {
      ID = 'id',
      NAME = 'name',
      URL = 'url',
      MIME_TYPE = 'mimeType',
    }

    enum ViewId {
      DOCS = 'docs',
      DOCUMENTS = 'documents',
    }

    enum DocsViewMode {
      LIST = 'list',
      GRID = 'grid',
    }
  }

  namespace accounts {
    namespace oauth2 {
      function initTokenClient(config: TokenClientConfig): TokenClient;

      interface TokenClientConfig {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type: string; message: string }) => void;
      }

      interface TokenClient {
        requestAccessToken(overrides?: { prompt?: string }): void;
      }

      interface TokenResponse {
        access_token: string;
        error?: string;
        expires_in: number;
        scope: string;
        token_type: string;
      }
    }
  }
}
