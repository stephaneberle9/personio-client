/**
 * Normalized recruiting records — flat, typed views of the v2 recruiting
 * objects, stable across the API's nested `{ 'date-time' }` timestamp shapes.
 */

export interface ApplicationRecord {
  id: string;
  applicationDate: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  jobId: string;
  jobName: string;
  department: string;
  stageName: string;
  stageType: string;
  channel: string;
  isAnonymized: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateRecord {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedinProfile: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  name: string;
  department: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}
