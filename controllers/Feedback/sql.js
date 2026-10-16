// Feedback comes from visits (Visits.Feedback / Visits.Notes); nothing is stored separately.
module.exports = {
    GET_COUNTS: () => {
        return `
            SELECT ISNULL(Feedback, 'NONE') AS Feedback, COUNT(*) AS Visits
            FROM dbo.Visits
            WHERE UserId = @UserId AND VisitDate BETWEEN @FromDate AND @ToDate
            GROUP BY ISNULL(Feedback, 'NONE')
        `;
    },

    // Per doctor: counts per response and the most recent response.
    GET_BY_DOCTOR: () => {
        return `
            SELECT
                d.DoctorId,
                d.DoctorName,
                d.Speciality,
                d.Category,
                SUM(CASE WHEN v.Feedback = 'POSITIVE' THEN 1 ELSE 0 END) AS Positive,
                SUM(CASE WHEN v.Feedback = 'NEUTRAL' THEN 1 ELSE 0 END) AS Neutral,
                SUM(CASE WHEN v.Feedback = 'NEGATIVE' THEN 1 ELSE 0 END) AS Negative,
                COUNT(*) AS Visits,
                (SELECT TOP (1) l.Feedback FROM dbo.Visits l
                 WHERE l.UserId = @UserId AND l.DoctorId = d.DoctorId AND l.Feedback IS NOT NULL
                 ORDER BY l.VisitDate DESC, l.CreatedOn DESC) AS LatestFeedback
            FROM dbo.Visits v
            INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
            WHERE v.UserId = @UserId AND v.VisitDate BETWEEN @FromDate AND @ToDate
            GROUP BY d.DoctorId, d.DoctorName, d.Speciality, d.Category
            ORDER BY Negative DESC, Visits DESC, d.DoctorName
        `;
    },

    // Calls that need attention: negative or neutral, with whatever was noted.
    GET_ATTENTION: () => {
        return `
            SELECT TOP (25)
                v.VisitId,
                CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate,
                v.Feedback,
                v.Notes,
                CONVERT(VARCHAR(10), v.FollowUpDate, 23) AS FollowUpDate,
                d.DoctorId,
                d.DoctorName,
                d.Category,
                d.HospitalName
            FROM dbo.Visits v
            INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
            WHERE v.UserId = @UserId
              AND v.VisitDate BETWEEN @FromDate AND @ToDate
              AND v.Feedback IN ('NEGATIVE', 'NEUTRAL')
            ORDER BY CASE v.Feedback WHEN 'NEGATIVE' THEN 0 ELSE 1 END, v.VisitDate DESC
        `;
    },
};
