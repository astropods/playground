# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 0.2.0 (2026-04-19)


### Features

* add voice input support to playground ([71457be](https://github.com/astropods/playground/commit/71457be9b3b2610e7d33f684b0c92983cbb986b6))
* allow playground to reload conversation history ([#19](https://github.com/astropods/playground/issues/19)) ([e80260e](https://github.com/astropods/playground/commit/e80260e1cd06ccb1aefdb1d617abf480c0d9e1ed))
* **audio:** add single and continuous voice modes ([1efd60e](https://github.com/astropods/playground/commit/1efd60e317e6e3b3cbbf8c428bd83c46cf46adf9))
* **audio:** add voice activity detection for automatic speech boundaries ([176be30](https://github.com/astropods/playground/commit/176be30ef6e9af3503768355e704767aa834abe2))
* **audio:** open SSE before audio WS and handle transcript events ([2abb8e9](https://github.com/astropods/playground/commit/2abb8e944d1614b1f4d376e010b3eb852753cbb1))
* focus text area. ([#1](https://github.com/astropods/playground/issues/1)) ([4e55727](https://github.com/astropods/playground/commit/4e5572776324090cf2a20ae7c8102a6955f8972a))
* update playground branding, styling, and dev server ([#2](https://github.com/astropods/playground/issues/2)) ([768ec44](https://github.com/astropods/playground/commit/768ec448234aa002b2780e490dcccf38016b086b))
* updated docker image name to astropods/playground ([#1](https://github.com/astropods/playground/issues/1)) ([21d2324](https://github.com/astropods/playground/commit/21d23242586e6c21f3bba2a2e72c212fd6139982))
* use astro-theme for color definitions ([#15](https://github.com/astropods/playground/issues/15)) ([f71284c](https://github.com/astropods/playground/commit/f71284cfddab1bfe81295e6aabbc3cfb879725e7))


### Bug Fixes

* add missing ONNX runtime .mjs files for VAD ([4f5cf15](https://github.com/astropods/playground/commit/4f5cf156b03fb4f2f96260454585b867c9da0dca))
* add nginx WebSocket proxy for audio endpoint ([7927e42](https://github.com/astropods/playground/commit/7927e42a1533686b943d4a275de244c84f8c9f7d))
* always show voice mode badge, hide send button while listening ([133001f](https://github.com/astropods/playground/commit/133001f8991cd8c255817e10b85bcac65b2c64eb))
* collect audio chunks before sending over WebSocket ([5897a99](https://github.com/astropods/playground/commit/5897a99c52f346033076e5fd48cd1bf920469adb))
* keep textarea focused while agent is responding ([0ffeb91](https://github.com/astropods/playground/commit/0ffeb919f677e04a69cf8c8a10622dc0813cc362))
* prevent model name wrapping in dropdown, left-align text ([4015a1e](https://github.com/astropods/playground/commit/4015a1ebc7dcdaf4fec1001c57b771d9e7bb3725))
* remove non-functional model selector dropdown ([fb686d7](https://github.com/astropods/playground/commit/fb686d74e95cc3646e044272b86d037cc52b7822))
* replace emoji favicon with real favicon and center empty state ([1ab2f4c](https://github.com/astropods/playground/commit/1ab2f4c7e032448af1eed5a41fa205543f50d3f4))
* show transcript text in audio user messages instead of hardcoded label ([339ac2d](https://github.com/astropods/playground/commit/339ac2d22afb5d0af241c953955062857d2bc083))
* use CDN for ONNX runtime to avoid nginx MIME type issues ([3e5de03](https://github.com/astropods/playground/commit/3e5de03e67a7edddf229e92f2f5c5f45cae97ea4))
* use infinity symbol for continuous voice mode badge ([07647dd](https://github.com/astropods/playground/commit/07647dd3bf1a35be81fb3bf3f5c2870286b7ef79))
* use rounded-md token instead of arbitrary 11px border radius ([cc29275](https://github.com/astropods/playground/commit/cc29275e237baa431f4aae239c801a2f7f618d44))
* use vite-plugin-static-copy for VAD/ONNX assets ([632d00e](https://github.com/astropods/playground/commit/632d00e02534f21692459bbb3703d98f7e4679d9))



## 0.1.0 (2026-04-19)


### Features

* add voice input support to playground ([71457be](https://github.com/astropods/playground/commit/71457be9b3b2610e7d33f684b0c92983cbb986b6))
* allow playground to reload conversation history ([#19](https://github.com/astropods/playground/issues/19)) ([e80260e](https://github.com/astropods/playground/commit/e80260e1cd06ccb1aefdb1d617abf480c0d9e1ed))
* **audio:** add single and continuous voice modes ([1efd60e](https://github.com/astropods/playground/commit/1efd60e317e6e3b3cbbf8c428bd83c46cf46adf9))
* **audio:** add voice activity detection for automatic speech boundaries ([176be30](https://github.com/astropods/playground/commit/176be30ef6e9af3503768355e704767aa834abe2))
* **audio:** open SSE before audio WS and handle transcript events ([2abb8e9](https://github.com/astropods/playground/commit/2abb8e944d1614b1f4d376e010b3eb852753cbb1))
* focus text area. ([#1](https://github.com/astropods/playground/issues/1)) ([4e55727](https://github.com/astropods/playground/commit/4e5572776324090cf2a20ae7c8102a6955f8972a))
* update playground branding, styling, and dev server ([#2](https://github.com/astropods/playground/issues/2)) ([768ec44](https://github.com/astropods/playground/commit/768ec448234aa002b2780e490dcccf38016b086b))
* updated docker image name to astropods/playground ([#1](https://github.com/astropods/playground/issues/1)) ([21d2324](https://github.com/astropods/playground/commit/21d23242586e6c21f3bba2a2e72c212fd6139982))
* use astro-theme for color definitions ([#15](https://github.com/astropods/playground/issues/15)) ([f71284c](https://github.com/astropods/playground/commit/f71284cfddab1bfe81295e6aabbc3cfb879725e7))


### Bug Fixes

* add missing ONNX runtime .mjs files for VAD ([4f5cf15](https://github.com/astropods/playground/commit/4f5cf156b03fb4f2f96260454585b867c9da0dca))
* add nginx WebSocket proxy for audio endpoint ([7927e42](https://github.com/astropods/playground/commit/7927e42a1533686b943d4a275de244c84f8c9f7d))
* always show voice mode badge, hide send button while listening ([133001f](https://github.com/astropods/playground/commit/133001f8991cd8c255817e10b85bcac65b2c64eb))
* collect audio chunks before sending over WebSocket ([5897a99](https://github.com/astropods/playground/commit/5897a99c52f346033076e5fd48cd1bf920469adb))
* keep textarea focused while agent is responding ([0ffeb91](https://github.com/astropods/playground/commit/0ffeb919f677e04a69cf8c8a10622dc0813cc362))
* prevent model name wrapping in dropdown, left-align text ([4015a1e](https://github.com/astropods/playground/commit/4015a1ebc7dcdaf4fec1001c57b771d9e7bb3725))
* remove non-functional model selector dropdown ([fb686d7](https://github.com/astropods/playground/commit/fb686d74e95cc3646e044272b86d037cc52b7822))
* replace emoji favicon with real favicon and center empty state ([1ab2f4c](https://github.com/astropods/playground/commit/1ab2f4c7e032448af1eed5a41fa205543f50d3f4))
* show transcript text in audio user messages instead of hardcoded label ([339ac2d](https://github.com/astropods/playground/commit/339ac2d22afb5d0af241c953955062857d2bc083))
* use CDN for ONNX runtime to avoid nginx MIME type issues ([3e5de03](https://github.com/astropods/playground/commit/3e5de03e67a7edddf229e92f2f5c5f45cae97ea4))
* use infinity symbol for continuous voice mode badge ([07647dd](https://github.com/astropods/playground/commit/07647dd3bf1a35be81fb3bf3f5c2870286b7ef79))
* use rounded-md token instead of arbitrary 11px border radius ([cc29275](https://github.com/astropods/playground/commit/cc29275e237baa431f4aae239c801a2f7f618d44))
* use vite-plugin-static-copy for VAD/ONNX assets ([632d00e](https://github.com/astropods/playground/commit/632d00e02534f21692459bbb3703d98f7e4679d9))
