.PHONY: all build optimize run

all: build optimize run

build:
	cargo build --release --target wasm32-unknown-unknown

optimize:
	mkdir -p ./bin
	[ -e ./bin/wasmplayground.wasm ] && rm ./bin/wasmplayground.wasm
	wasm-opt -Oz -o ./bin/wasmplayground.wasm ./target/wasm32-unknown-unknown/release/wasmplayground.wasm

run:
	node ./main.js
