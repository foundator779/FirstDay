declare module "react-dom/server" {
  import type { ReactNode } from "react";

  export function renderToStaticMarkup(node: ReactNode): string;
}

declare module "react-native-web" {
  export * from "react-native";
}
