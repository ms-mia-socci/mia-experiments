import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/browser',timeout:300_000,workers:1,use:{baseURL:'http://127.0.0.1:5273',viewport:{width:1440,height:1000}},reporter:'list'});
