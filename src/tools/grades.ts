import { z } from "zod";
import { MoodleClient } from "../moodleClient.js";

export const getGradeItems = {
  name: "moodle_get_grade_items",
  description: "Récupère les notes d'un utilisateur dans un cours.",
  inputSchema: z.object({
    courseid: z.number().describe("ID du cours"),
    userid: z.number().describe("ID de l'utilisateur"),
  }),
  outputSchema: z.object({
    gradeItems: z.array(
      z.object({
        id: z.number(),
        itemname: z.string(),
        grade: z.string().optional(),
        feedback: z.string().optional(),
      })
    ),
    courseName: z.string(),
    userName: z.string(),
  }),
  handler: async (params: { courseid: number; userid: number }, client: MoodleClient) => {
    const response = await client.callFunction("gradereport_user_get_grade_items", {
      courseid: params.courseid,
      userid: params.userid,
    });

    const courseInfo = await client.callFunction<any[]>("core_course_get_courses", {
      options: { ids: [params.courseid] },
    });
    const courseName = courseInfo[0]?.fullname || "Cours inconnu";

    const userInfo = await client.callFunction<{ users: any[] }>("core_user_get_users", {
      criteria: [{ key: "id", value: params.userid }],
    });
    const userName = `${userInfo.users[0]?.firstname} ${userInfo.users[0]?.lastname}` || "Utilisateur inconnu";

    const gradeItems = response.usergrades?.[0]?.gradeitems?.map((item: any) => ({
      id: item.id,
      itemname: item.itemname,
      grade: item.grade,
      feedback: item.feedback,
    })) || [];

    return { gradeItems, courseName, userName };
  },
};
