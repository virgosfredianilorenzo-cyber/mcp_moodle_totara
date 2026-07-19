import { z } from "zod";
import { MoodleClient } from "../moodleClient.js";

interface ScormTrack {
  element: string;
  value: string;
}

function findTrackValue(tracks: ScormTrack[], element: string): string | undefined {
  return tracks.find((track) => track.element === element)?.value;
}

// cmi.core.total_time (SCORM 1.2) is "HH:MM:SS[.ss]"; cmi.total_time (SCORM 2004) is an ISO 8601 duration.
// Moodle normalizes both onto the "total_time" track element without normalizing the format itself.
function parseScormTimeToSeconds(value?: string): number {
  if (!value) return 0;

  const isoMatch = value.match(/^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (isoMatch) {
    const hours = parseInt(isoMatch[1] || "0", 10);
    const minutes = parseInt(isoMatch[2] || "0", 10);
    const seconds = parseFloat(isoMatch[3] || "0");
    return hours * 3600 + minutes * 60 + Math.round(seconds);
  }

  const hmsMatch = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (hmsMatch) {
    const hours = parseInt(hmsMatch[1], 10);
    const minutes = parseInt(hmsMatch[2], 10);
    const seconds = parseFloat(hmsMatch[3]);
    return hours * 3600 + minutes * 60 + Math.round(seconds);
  }

  return 0;
}

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
      const enrolledUsers = await client.callFunction<any[]>("core_enrol_get_enrolled_users", {
        courseid: params.courseid,
      });
      users = enrolledUsers;
    } else {
      const allUsers = await client.callFunction<{ users: any[] }>("core_user_get_users", {});
      users = allUsers.users;
    }

    // Récupérer le nom du SCORM
    const scormInfo = await client.callFunction<{ scorms: any[] }>("mod_scorm_get_scorms_by_courses", {
      courseids: [params.courseid || 0],
    });
    const scormname = scormInfo.scorms.find((s: any) => s.id === params.scormid)?.name || "SCORM inconnu";

    // Récupérer les SCOs du module SCORM : le dernier SCO "lançable" reflète l'avancement global du module
    const scoesInfo = await client.callFunction<{ scoes: any[] }>("mod_scorm_get_scorm_scoes", {
      scormid: params.scormid,
    });
    const launchableScoes = scoesInfo.scoes.filter((sco: any) => sco.scormtype === "sco");
    const mainSco = launchableScoes[launchableScoes.length - 1];

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
    if (mainSco) {
      for (const user of users) {
        const attemptCount = await client.callFunction<{ attemptscount: number }>("mod_scorm_get_scorm_attempt_count", {
          scormid: params.scormid,
          userid: user.id,
        });
        if (!attemptCount.attemptscount) {
          continue;
        }

        const scoTracks = await client.callFunction<{ data: { attempt: number; tracks: ScormTrack[] } }>(
          "mod_scorm_get_scorm_sco_tracks",
          {
            scoid: mainSco.id,
            userid: user.id,
            attempt: 0, // 0 = dernière tentative
          }
        );

        const tracks = scoTracks.data?.tracks || [];
        const status = findTrackValue(tracks, "status");
        if (!status) {
          continue;
        }

        const completed = status === "completed" || status === "passed";
        const rawScore = findTrackValue(tracks, "score_raw");
        const score = rawScore !== undefined ? parseFloat(rawScore) : undefined;
        const timespent = parseScormTimeToSeconds(findTrackValue(tracks, "total_time"));

        report.users.push({
          userid: user.id,
          username: user.username,
          firstname: user.firstname,
          lastname: user.lastname,
          completed,
          score,
          timespent,
        });
        if (completed) {
          report.completedUsers++;
          report.averageScore += score || 0;
          report.averageTimeSpent += timespent;
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
