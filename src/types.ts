/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Advisor {
  id: string;
  name: string;
  imageUrl?: string;
}

export interface Group {
  id: string;
  advisorId: string;
  members: string[];
  classroom: string;
  registeredAt: number;
  createdBy?: string;
}

export interface AppState {
  advisors: Advisor[];
  groups: Group[];
}

export const CLASSROOMS = ["DB-GP 3/1", "DB-GP 3/2", "DB-GP 3/3"] as const;
export type Classroom = (typeof CLASSROOMS)[number];
