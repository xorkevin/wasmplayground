.PHONY: all build optimize run

all: build optimize run

build:
	cargo build --release --target wasm32-unknown-unknown

optimize:
	mkdir -p ./bin
	if [ -e ./bin/wasmplayground.wasm ]; then rm ./bin/wasmplayground.wasm; fi
	wasm-opt -Os -o ./bin/wasmplayground.wasm ./target/wasm32-unknown-unknown/release/wasmplayground.wasm

run:
	node ./main.js
