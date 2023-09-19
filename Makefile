.PHONY:

build:
	cargo build --release --target wasm32-unknown-unknown

run:
	node ./wasmmod.js
