# js/vendor

`anthropic-sdk.js` is Anthropic's official TypeScript/JavaScript SDK (`@anthropic-ai/sdk` 1.3.0, Apache-2.0), bundled into one browser file that sets `window.PMCAnthropic`. The 🤖 AI take in Publish Daily Report loads it on first use (see `loadAnthropicSdk` in js/app.js), never at start-up.

Rebuild (from an empty folder, outside the repo):

```sh
npm init -y && npm install --ignore-scripts @anthropic-ai/sdk@<version>
printf 'import Anthropic from "@anthropic-ai/sdk";\nself.PMCAnthropic = Anthropic;\n' > entry.mjs
NODE_PATH=node_modules <repo>/installer/node_modules/.bin/esbuild entry.mjs --bundle --format=iife \
  --platform=browser --target=es2019 --minify --legal-comments=inline --conditions=browser --outfile=anthropic-sdk.js
```

Then put the one-line licence comment back on top, and bump the `?v=` tag. Pick a release at least two weeks old.
