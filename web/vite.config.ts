import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // 어느 하위 경로에 올려도 동작하도록 상대 경로로 빌드한다 (화면 이동은 HashRouter)
  base: './',
  test: {
    environment: 'node',
  },
});
