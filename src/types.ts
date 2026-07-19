import { z } from "zod";

// Type pour un cours Moodle
export const CourseSchema = z.object({
  id: z.number(),
  shortname: z.string(),
  fullname: z.string(),
  categoryid: z.number(),
  summary: z.string().optional(),
});

export type Course = z.infer<typeof CourseSchema>;

// Type pour un utilisateur Moodle
export const UserSchema = z.object({
  id: z.number(),
  username: z.string(),
  firstname: z.string(),
  lastname: z.string(),
  email: z.string().email(),
});

export type User = z.infer<typeof UserSchema>;

// Type pour une inscription
export const EnrolmentSchema = z.object({
  id: z.number(),
  userid: z.number(),
  courseid: z.number(),
  roleid: z.number(),
});

export type Enrolment = z.infer<typeof EnrolmentSchema>;

// Type pour une note
export const GradeItemSchema = z.object({
  id: z.number(),
  courseid: z.number(),
  userid: z.number(),
  itemname: z.string(),
  grade: z.string().optional(),
  feedback: z.string().optional(),
});

export type GradeItem = z.infer<typeof GradeItemSchema>;
