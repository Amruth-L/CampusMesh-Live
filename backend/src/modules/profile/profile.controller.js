const pool = require('../../config/database');
const bcrypt = require('bcrypt');

class ProfileController {
  /**
   * GET /api/profile
   * Fetch active user's details.
   */
  async getProfile(req, res) {
    try {
      const userId = req.user.id;
      const userRes = await pool.query(
        'SELECT id, name, username, email, phone_number, avatar_url, bio, department, hostel, active_mode, delivery_available, account_type, created_at FROM users WHERE id = $1',
        [userId],
      );

      if (userRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found.',
        });
      }

      return res.status(200).json({
        success: true,
        profile: userRes.rows[0],
      });
    } catch (error) {
      console.error('Error in getProfile:', error.message || error);
      return res.status(500).json({
        success: false,
        message: 'Internal Server Error',
      });
    }
  }

  /**
   * PUT /api/profile
   * Update the authenticated user's details.
   */
  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const {
        name,
        username,
        email,
        phone_number,
        avatar_url,
        bio,
        department,
        hostel,
        old_password,
        new_password,
      } = req.body;

      // 1. Fetch current user from database
      const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }
      const currentUser = userRes.rows[0];

      const updateFields = [];
      const queryValues = [];
      let valIdx = 1;

      // 2. Validate and handle Username update
      if (username !== undefined) {
        const trimmedUsername = username.trim().toLowerCase();
        if (trimmedUsername !== currentUser.username) {
          const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
          if (!usernameRegex.test(trimmedUsername)) {
            return res
              .status(400)
              .json({
                success: false,
                message: 'Username must be 3-20 characters (alphanumeric/underscores).',
              });
          }
          // Check uniqueness
          const uniqCheck = await pool.query('SELECT id FROM users WHERE username = $1', [trimmedUsername]);
          if (uniqCheck.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'Username is already taken.' });
          }
          updateFields.push(`username = $${valIdx++}`);
          queryValues.push(trimmedUsername);
        }
      }

      // A verified sign-in identity cannot be replaced by a generic profile edit.
      if (email !== undefined) {
        if (typeof email !== 'string' || email.trim().toLowerCase() !== currentUser.email.trim().toLowerCase())
          return res.status(400).json({ success: false, message: 'Your verified campus email cannot be changed in profile settings.' });
      }

      // 4. Handle Password Update (requires old password check)
      if (new_password) {
        if (!old_password) {
          return res
            .status(400)
            .json({ success: false, message: 'Current password is required to set a new password.' });
        }
        // Verify current password
        const isMatch = await bcrypt.compare(old_password, currentUser.password);
        if (!isMatch) {
          return res.status(400).json({ success: false, message: 'Incorrect current password.' });
        }
        // Validate strength
        if (new_password.length < 6) {
          return res
            .status(400)
            .json({ success: false, message: 'New password must be at least 6 characters.' });
        }
        // Hash and push
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);
        updateFields.push(`password = $${valIdx++}`);
        queryValues.push(hashedPassword);
      }

      // 5. Build other fields
      if (name !== undefined) {
        updateFields.push(`name = $${valIdx++}`);
        queryValues.push(name.trim());
      }
      if (phone_number !== undefined) {
        updateFields.push(`phone_number = $${valIdx++}`);
        queryValues.push(phone_number.trim());
      }
      if (avatar_url !== undefined) {
        updateFields.push(`avatar_url = $${valIdx++}`);
        queryValues.push(avatar_url ? avatar_url.trim() : null);
      }
      if (bio !== undefined) {
        if (bio && bio.length > 300) {
          return res.status(400).json({ success: false, message: 'Bio cannot exceed 300 characters.' });
        }
        updateFields.push(`bio = $${valIdx++}`);
        queryValues.push(bio ? bio.trim() : null);
      }
      if (department !== undefined) {
        updateFields.push(`department = $${valIdx++}`);
        queryValues.push(department.trim());
      }
      if (hostel !== undefined) {
        updateFields.push(`hostel = $${valIdx++}`);
        queryValues.push(hostel ? hostel.trim() : null);
      }

      if (updateFields.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No changes provided.',
          profile: {
            id: currentUser.id,
            name: currentUser.name,
            username: currentUser.username,
            email: currentUser.email,
            phone_number: currentUser.phone_number,
            avatar_url: currentUser.avatar_url,
            bio: currentUser.bio,
            department: currentUser.department,
            hostel: currentUser.hostel,
            active_mode: currentUser.active_mode,
            delivery_available: currentUser.delivery_available,
            account_type: currentUser.account_type,
            created_at: currentUser.created_at,
          },
        });
      }

      // 6. Run update query
      queryValues.push(userId);
      const updateQuery = `
        UPDATE users SET ${updateFields.join(', ')}
        WHERE id = $${valIdx}
        RETURNING id, name, username, email, phone_number, avatar_url, bio, department, hostel, active_mode, delivery_available, account_type, created_at
      `;
      const updateRes = await pool.query(updateQuery, queryValues);

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully.',
        profile: updateRes.rows[0],
      });
    } catch (error) {
      console.error('Error in updateProfile:', error.message || error);
      return res.status(500).json({
        success: false,
        message: 'Internal Server Error',
      });
    }
  }
}

module.exports = new ProfileController();
