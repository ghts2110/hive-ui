import {defineConfig} from '@playwright/test';

export default defineConfig({
	testDir: './test/gui',
	workers: 1,
	fullyParallel: false,
	reporter: 'list',
	use: {headless: true, viewport: {width: 1440, height: 960}, trace: 'retain-on-failure'},
});
