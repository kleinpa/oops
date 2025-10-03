# oops

This project is an experiment in creating a self-modifying web application, powered by in-browser machine learning models.

It is a web application built with Vue.js, Vite, and TypeScript. It uses `@huggingface/transformers` to run machine learning models directly in the browser, `@xterm/xterm` to provide a terminal-like interface, and `marked` for Markdown rendering. The goal is to explore how an application can understand and modify its own source code using AI.

## Project Setup

### Prerequisites

- Node.js
- pnpm (recommended, as the project is configured for it)

### Installation

1.  Clone the repository.
2.  Install the dependencies using pnpm:
    ```bash
    pnpm install
    ```

### Running for Development

To start the local development server, run:
```bash
pnpm run dev
```

### Building for Production

To build the application for production, run:
```bash
pnpm run build
```