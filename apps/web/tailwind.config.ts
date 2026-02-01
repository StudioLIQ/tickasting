import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        kaspa: {
          primary: '#49EACB',
          dark: '#0D1117',
        },
      },
    },
  },
  plugins: [],
}

export default config
