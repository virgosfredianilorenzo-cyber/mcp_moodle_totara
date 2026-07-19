import { z } from "zod";
import { MoodleClient } from "../moodleClient.js";

export const getScormsByCourses = {
  name: "moodle_get_scorms_by_courses",
  description: "Liste les modules SCORM disponibles dans un ou plusieurs cours.",
  inputSchema: z.object({
    courseids: z.array(z.number()).describe("Liste des IDs de cours"),
  }),
  outputSchema: z.object({
    scorms: z.array(
      z.object({
        id: z.number(),
        course: z.number(),
        name: z.string(),
        reference: z.string().optional(),
        version: z.string().optional(),
      })
    ),
  }),
  handler: async (params: { courseids: number[] }, client: MoodleClient) => {
    const response = await client.callFunction<{ scorms: any[] }>("mod_scorm_get_scorms_by_courses", {
      courseids: params.courseids,
    });
    const scorms = response.scorms.map((scorm: any) => ({
      id: scorm.id,
      course: scorm.course,
      name: scorm.name,
      reference: scorm.reference,
      version: scorm.version,
    }));
    return { scorms };
  },
};

export const getScormCompletionReport = {
  name: "moodle_get_scorm_completion_report",
  description: "Génère un rapport de complétion pour un module SCORM.",
  inputSchema: z.object({
    scormid: z.number().describe("ID du module SCORM"),
    courseid: z.number().optional().describe("ID du cours (optionnel, pour filtrer les utilisateurs)"),
  }),
  outputSchema: z.object({
    scormname: z.string(),
    totalUsers: z.number(),
    completedUsers: z.number(),
    completionRate: z.number(), // Pourcentage (0-100)
    averageScore: z.number().optional(),
    averageTimeSpent: z.number().optional(), // En secondes
    users: z.array(
      z.object({
        userid: z.number(),
        username: z.string(),
        firstname: z.string(),
        lastname: z.string(),
        completed: z.boolean(),
        score: z.number().optional(),
        timespent: z.number().optional(),
      })
    ),
  }),
  handler: async (params: { scormid: number; courseid?: number }, client: MoodleClient) => {
    // Récupérer les utilisateurs
    let users: any[] = [];
    if (params.courseid) {
      const enrolledUsers = await client.callFunction<{ users: any[] }>("core_enrol_get_enrolled_users", {
        courseid: params.courseid,
      });
      users = enrolledUsers.users;
    } else {
      const allUsers = await client.callFunction<{ users: any[] }>("core_user_get_users", {});
      users = allUsers.users;
    }

    // Récupérer le nom du SCORM
    const scormInfo = await client.callFunction<{ scorms: any[] }>("mod_scorm_get_scorms_by_courses", {
      courseids: [params.courseid || 0],
    });
    const scormname = scormInfo.scorms.find((s: any) => s.id === params.scormid)?.name || "SCORM inconnu";

    // Initialiser le rapport
    const report: any = {
      scormname,
      totalUsers: users.length,
      completedUsers: 0,
      completionRate: 0,
      averageScore: 0,
      averageTimeSpent: 0,
      users: [],
    };

    // Traiter chaque utilisateur
    for (const user of users) {
      const attempts = await client.callFunction<{ attempts: any[] }>("mod_scorm_get_scorm_access_information", {
        scormid: params.scormid,
        userid: user.id,
      });

      const lastAttempt = attempts.attempts?.[0];
      if (lastAttempt) {
        report.users.push({
          userid: user.id,
          username: user.username,
          firstname: user.firstname,
          lastname: user.lastname,
          completed: lastAttempt.status === "completed",
          score: lastAttempt.score,
          timespent: lastAttempt.timespent,
        });
        if (lastAttempt.status === "completed") {
          report.completedUsers++;
          report.averageScore += lastAttempt.score || 0;
          report.averageTimeSpent += lastAttempt.timespent || 0;
        }
      }
    }

    // Calculer les moyennes
    if (report.completedUsers > 0) {
      report.completionRate = Math.round((report.completedUsers / report.totalUsers) * 100);
      report.averageScore = report.averageScore / report.completedUsers;
      report.averageTimeSpent = Math.round(report.averageTimeSpent / report.completedUsers);
    }

    return report;
  },
};
