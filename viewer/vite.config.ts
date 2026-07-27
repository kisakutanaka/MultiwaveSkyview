import { defineConfig } from "vite";

// GitHub Pages project page: served at https://<user>.github.io/MultiwaveSkyview/,
// so all asset URLs need this prefix. If you rename the repo, update this too.
export default defineConfig({
  base: "/MultiwaveSkyview/",
});
