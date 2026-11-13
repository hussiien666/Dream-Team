import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>{const env=loadEnv(mode,'.','');return {plugins:[react()],base:env.SCANNER_BASE_PATH || (env.VERCEL==='1'?'/':'/scan/'),server:{port:5173,proxy:{'/api':{target:'http://127.0.0.1:3000'}}}};});
