import { z } from "zod";
import { MoodleClient } from "../moodleClient.js";
import { CourseSchema } from "../types.js";

export const getCourses = {
  name: "moodle_get_courses",
  description: "Liste les cours disponibles sur Moodle.",
  inputSchema: z.object({
    options: z.object({
      ids: z.array(z.number()).optional(),
      categoryid: z.number().optional(),
    }).optional(),
  }),
  outputSchema: z.object({
    courses: z.array(CourseSchema),
  }),
  handler: async (params: { options?: { ids?: number[]; categoryid?: number } }, client: MoodleClient) => {
    const response = await client.callFunction<{ courses: any[] }>("core_course_get_courses", params);
    const courses = response.courses.map((course: any) => ({
      id: course.id,
      shortname: course.shortname,
      fullname: course.fullname,
      categoryid: course.categoryid,
      summary: course.summary,
    }));
    return { courses };
  },
};
