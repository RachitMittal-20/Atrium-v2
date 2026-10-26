# Third-party software

Direct dependencies from `package.json`. Versions and licences are read from each package's own `package.json` in `node_modules`; nothing is guessed. Transitive dependencies are not listed.

## Dependencies

| Package | Installed version | Licence (from its package.json) |
| --- | --- | --- |
| @gsap/react | 2.1.2 | SEE LICENSE AT https://gsap.com/standard-license |
| @react-three/drei | 10.7.9 | MIT |
| @react-three/fiber | 9.8.1 | MIT |
| gsap | 3.15.0 | Standard 'no charge' license: https://gsap.com/standard-license. |
| immer | 10.2.0 | MIT |
| lenis | 1.3.26 | MIT |
| next | 16.3.4 | MIT |
| pdf-lib | 1.17.1 | MIT |
| pdfjs-dist | 6.4.299 | Apache-2.0 |
| react | 19.2.8 | MIT |
| react-dom | 19.2.8 | MIT |
| tesseract.js | 5.1.1 | Apache-2.0 |
| three | 0.186.1 | MIT |
| zustand | 5.0.15 | MIT |

## Dev dependencies

| Package | Installed version | Licence (from its package.json) |
| --- | --- | --- |
| @tailwindcss/postcss | 4.3.3 | MIT |
| @types/node | 20.19.43 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @types/three | 0.185.4 | MIT |
| eslint | 9.39.5 | MIT |
| eslint-config-next | 16.3.4 | MIT |
| playwright | 1.63.0 | Apache-2.0 |
| sharp | 0.35.5 | Apache-2.0 |
| tailwindcss | 4.3.3 | MIT |
| three-stdlib | 2.36.1 | MIT |
| tsx | 4.23.15 | MIT |
| typescript | 5.9.3 | Apache-2.0 |


## Fonts

Marcellus and Figtree (latin woff2 files in `src/app/fonts/`): the repo records no licence for them, so check the font source (Google Fonts).

## Other bundled files

tesseract.js-core and the OCR language data: see [`public/tesseract/LICENSES.md`](public/tesseract/LICENSES.md). pdf.js WebAssembly: licences sit beside the files in `public/pdfjs/wasm/`.
