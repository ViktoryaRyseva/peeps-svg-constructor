import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const directory=process.env.PEEPS_TEST_DATA ?? mkdtempSync(join(tmpdir(),'peeps-file-ui-'));
process.env.PEEPS_TEST_DATA=directory;
export default defineConfig({
 testDir:'./src/tests/files',workers:1,fullyParallel:false,reporter:'list',
 outputDir:'test-results/files',
 use:{baseURL:'http://127.0.0.1:5175',channel:'chrome',viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'npm run dev -- --port 5175 --strictPort',env:{PEEPS_DATA_DIR:directory},url:'http://127.0.0.1:5175',reuseExistingServer:false},
});
