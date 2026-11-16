/// <reference types="vite/client" />
declare const __DEMO_BUILD__: boolean;
declare module '*.sql?raw' {
  const sql: string;
  export default sql;
}
