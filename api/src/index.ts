import express, { Express, Request, Response } from 'express';
import cors from 'cors';

const app: Express = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Routes will be added here
// app.use('/api/logs', logsRouter);
// app.use('/api/alerts', alertsRouter);

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
