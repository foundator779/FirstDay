import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/dist-bedrock/**", "**/node_modules/**", "apps/mobile/.expo/**", "test-results/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
