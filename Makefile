.PHONY: all build optimize run

all: build optimize run

build:
	cargo build --release --target wasm32-unknown-unknown
	cd asmscript && npm run asbuild

optimize:
	mkdir -p ./bin
	if [ -e ./bin/wasmplayground.wasm ]; then rm ./bin/wasmplayground.wasm; fi
	wasm-opt -Os -o ./bin/wasmplayground.wasm ./target/wasm32-unknown-unknown/release/wasmplayground.wasm
	if [ -e ./bin/asmscript.wasm ]; then rm ./bin/asmscript.wasm; fi
	wasm-opt -Os -o ./bin/asmscript.wasm ./asmscript/build/release.wasm

run:
	node ./main.js
