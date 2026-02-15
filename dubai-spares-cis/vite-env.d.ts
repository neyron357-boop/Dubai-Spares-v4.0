/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_ONLY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
