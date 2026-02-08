# devpost-digitalocean-storyapp
For devpost DigitalOcean Hackathon

## Project Structure

This project is a monorepo containing the following applications and packages:

-   `apps/frontend`: A [Next.js](https://nextjs.org/) application for the user interface.
-   `apps/backend`: A [FastAPI](https://fastapi.tiangolo.com/) application for the server.
-   `packages/ai-definitions`: A Python package for Pydantic AI definitions.
-   `packages/do-adk`: A placeholder for DigitalOcean ADK configurations.

## Getting Started

To get started with this project, you'll need to have [Node.js](https://nodejs.org/) and [Python](https://www.python.org/) installed.

1.  **Install dependencies:**

    From the root of the project, run the following command to install the dependencies for the frontend application:

    ```bash
    npm install
    ```

    To install the dependencies for the backend, navigate to the `apps/backend` directory and run:

    ```bash
    pip install -r requirements.txt
    ```

2.  **Run the applications:**

    -   **Frontend:** To start the Next.js development server, run the following command from the root of the project:

        ```bash
        npm run dev --workspace=apps/frontend
        ```

    -   **Backend:** To start the FastAPI server, navigate to the `apps/backend` directory and run:

        ```bash
        uvicorn main:app --reload
        ```
