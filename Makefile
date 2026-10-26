.PHONY: test eval lint typecheck build check clean

test:
	pnpm test

eval:
	pnpm eval

lint:
	pnpm lint

typecheck:
	pnpm typecheck

build:
	pnpm build

check: lint typecheck test eval

clean:
	rm -rf .next node_modules/.cache
