import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'node:path'

export default defineConfig(({ command }) => {
  const isBuild = command === 'build'

  return {
    // dev 使用默认 base，build 使用相对路径，确保通过 file:// 加载 dist/index.html 时能正确引用 ./assets/* 资源
    base: isBuild ? './' : '/',
    plugins: [react()],
    server: {
      port: 5174,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
      },
    },
  }
})
