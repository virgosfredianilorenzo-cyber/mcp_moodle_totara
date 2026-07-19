import { z } from "zod";
import { MoodleClient } from "../moodleClient.js";

export const getCompletionReport = {
  name: "moodle_get_completion_report",
  description: "Génère un rapport de complétion pour un cours.",
  inputSchema: z.object({
    courseid: z.number().describe("ID du cours"),
  }),
  outputSchema: z.object({
    courseid: z.number(),
    coursename: z.string(),
    totalActivities: z.number(),
    completedActivities: z.number(),
    completionRate: z.number(), // Pourcentage (0-100)
    users: z.array(
      z.object({
        userid: z.number(),
        username: z.string(),
        firstname: z.string(),
        lastname: z.string(),
        completed: z.boolean(),
        progress: z.number(), // Pourcentage (0-100)
      })
    ),
  }),
  handler: async (params: { courseid: number }, client: MoodleClient) => {
    // Récupérer les activités du cours
    const courseContents = await client.callFunction<any[]>("core_course_get_contents", {
      courseid: params.courseid,
    });

    // Récupérer les utilisateurs inscrits
    const enrolledUsers = await client.callFunction<any[]>("core_enrol_get_enrolled_users", {
      courseid: params.courseid,
    });

    // Récupérer le nom du cours
    const courseInfo = await client.callFunction<any[]>("core_course_get_courses", {
      options: { ids: [params.courseid] },
    });
    const coursename = courseInfo[0]?.fullname || "Cours inconnu";

    // Compter le nombre total d'activités (modules)
    const activities = courseContents.flatMap((section: any) =>
      section.modules.filter((module: any) => module.modname !== "label" && module.modname !== "resource")
    );
    const totalActivities = activities.length;

    // Initialiser le rapport
    const report: any = {
      courseid: params.courseid,
      coursename,
      totalActivities,
      completedActivities: 0,
      completionRate: 0,
      users: [],
    };

    // Traiter chaque utilisateur
    for (const user of enrolledUsers) {
      const completionStatus = await client.callFunction<{ statuses: any[] }>("core_completion_get_activities_completion_status", {
        courseid: params.courseid,
        userid: user.id,
      });

      const userActivities = completionStatus.statuses;
      const completedActivities = userActivities.filter((a: any) => a.completionstate === 1).length;
      const progress = Math.round((completedActivities / totalActivities) * 100);

      report.completedActivities += completedActivities;
      report.users.push({
        userid: user.id,
        username: user.username,
        firstname: user.firstname,
        lastname: user.lastname,
        completed: completedActivities === totalActivities,
        progress,
      });
    }

    // Calculer le taux de complétion global
    if (enrolledUsers.length > 0) {
      report.completionRate = Math.round((report.completedActivities / (totalActivities * enrolledUsers.length)) * 100);
    }

    return report;
  },
};
