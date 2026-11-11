import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>({plugins:[react()],base:loadEnv(mode,'.','').SCANNER_BASE_PATH || '/scan/',server:{port:5173,proxy:{'/api':{target:'http://127.0.0.1:3000'}}}}));
