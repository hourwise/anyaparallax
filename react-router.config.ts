import type { Config } from "@react-router/dev/config";

export default {
  // Server-rendered so photographs later get real URLs, status codes, and
  // social preview metadata.
  ssr: true,
} satisfies Config;
