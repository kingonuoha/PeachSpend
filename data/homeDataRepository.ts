import { databaseService } from '../services/DatabaseService';
import { HomeDataService } from './HomeDataService';

export const homeDataService = new HomeDataService(databaseService);
