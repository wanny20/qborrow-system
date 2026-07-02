import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../firebase/firebaseConfig";
import ImageCropModal from "../components/ImageCropModal";
import { useToast } from "../components/ToastContext.jsx";
import "../styles/Settings.css";

function Settings() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const outletContext = useOutletContext() || {};
  const { setUnsavedChanges, guardedNavigate } = outletContext;

  const [currentUser, setCurrentUser] = useState(null);
  const [userRecord, setUserRecord] = useState(null);
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [croppedPhotoBlob, setCroppedPhotoBlob] = useState(null);
  const [croppedPhotoSize, setCroppedPhotoSize] = useState(0);
  const [cropSourceFile, setCropSourceFile] = useState(null);

  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [profileFieldErrors, setProfileFieldErrors] = useState({});
  const [passwordFieldErrors, setPasswordFieldErrors] = useState({});

  const [profileTouched, setProfileTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function showActionError(shortMessage, error) {
    const detailedMessage = error?.message
      ? `${shortMessage}: ${error.message}`
      : shortMessage;

    showStatus(detailedMessage, "error");
    showToast(shortMessage, "error");
  }

  function showBlockedAction(message) {
    showStatus(message, "error");
    showToast(message, "error");
  }

  function markProfileChanged() {
    setProfileTouched(true);
  }

  function markPasswordChanged() {
    setPasswordTouched(true);
  }

  function clearProfileFieldError(fieldName) {
    setProfileFieldErrors((previousErrors) => ({
      ...previousErrors,
      [fieldName]: "",
    }));
  }

  function clearPasswordFieldError(fieldName) {
    setPasswordFieldErrors((previousErrors) => ({
      ...previousErrors,
      [fieldName]: "",
    }));
  }

  function isValidPersonName(value) {
    const cleanedValue = String(value || "").trim();

    if (cleanedValue.length < 2) return false;
    if (cleanedValue.length > 80) return false;

    return /^[\p{L}][\p{L}\s.'-]*[\p{L}.]$/u.test(cleanedValue);
  }

  function getPersonNameError(value) {
    const cleanedValue = String(value || "").trim();

    if (!cleanedValue) {
      return "Display name is required.";
    }

    if (cleanedValue.length < 2) {
      return "Display name must be at least 2 characters.";
    }

    if (cleanedValue.length > 80) {
      return "Display name must not exceed 80 characters.";
    }

    if (!isValidPersonName(cleanedValue)) {
      return "Display name can only contain letters, spaces, dot, hyphen, and apostrophe.";
    }

    return "";
  }

  function sanitizePersonNameInput(value) {
    return String(value || "").replace(/[^\p{L}\s.'-]/gu, "");
  }

  function validateProfileField(fieldName) {
    setProfileFieldErrors((previousErrors) => {
      const nextErrors = { ...previousErrors };

      if (fieldName === "fullName") {
        const fullNameError = getPersonNameError(fullName);

        if (fullNameError) {
          nextErrors.fullName = fullNameError;
        } else {
          delete nextErrors.fullName;
        }
      }

      return nextErrors;
    });
  }

  function validatePasswordField(fieldName) {
    setPasswordFieldErrors((previousErrors) => {
      const nextErrors = { ...previousErrors };

      if (fieldName === "passwordCurrent") {
        if (!passwordCurrent) {
          nextErrors.passwordCurrent = "Current password is required.";
        } else {
          delete nextErrors.passwordCurrent;
        }
      }

      if (fieldName === "newPassword") {
        if (!newPassword) {
          nextErrors.newPassword = "New password is required.";
        } else if (newPassword.length < 6) {
          nextErrors.newPassword = "New password must be at least 6 characters.";
        } else {
          delete nextErrors.newPassword;
        }

        if (confirmNewPassword && newPassword !== confirmNewPassword) {
          nextErrors.confirmNewPassword = "New passwords do not match.";
        } else if (confirmNewPassword) {
          delete nextErrors.confirmNewPassword;
        }
      }

      if (fieldName === "confirmNewPassword") {
        if (!confirmNewPassword) {
          nextErrors.confirmNewPassword = "Please confirm your new password.";
        } else if (newPassword !== confirmNewPassword) {
          nextErrors.confirmNewPassword = "New passwords do not match.";
        } else {
          delete nextErrors.confirmNewPassword;
        }
      }

      return nextErrors;
    });
  }

  function validateProfileForm() {
    const errors = {};
    const fullNameError = getPersonNameError(fullName);

    if (fullNameError) {
      errors.fullName = fullNameError;
    }

    setProfileFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validatePasswordForm() {
    const errors = {};

    if (!passwordCurrent) {
      errors.passwordCurrent = "Current password is required.";
    }

    if (!newPassword) {
      errors.newPassword = "New password is required.";
    } else if (newPassword.length < 6) {
      errors.newPassword = "New password must be at least 6 characters.";
    }

    if (!confirmNewPassword) {
      errors.confirmNewPassword = "Please confirm your new password.";
    } else if (newPassword !== confirmNewPassword) {
      errors.confirmNewPassword = "New passwords do not match.";
    }

    setPasswordFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function getRoleLabel(role) {
    if (role === "superAdmin") return "Super Admin";
    if (role === "categoryAdmin") return "Category Admin";
    return "Borrower";
  }

  function getDateFromValue(value) {
    if (!value) return null;

    if (typeof value?.toDate === "function") {
      return value.toDate();
    }

    if (value?.seconds) {
      return new Date(value.seconds * 1000);
    }

    const parsedDate = new Date(value);

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  function formatBorrowingDateTime(value) {
    const date = getDateFromValue(value);

    if (!date) return "No active restriction";

    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function getBorrowingStatusInfo() {
    if (userRecord?.role !== "borrower") {
      return null;
    }

    const suspendedUntilDate = getDateFromValue(userRecord?.suspendedUntil);
    const hasFutureRestriction =
      suspendedUntilDate && suspendedUntilDate > new Date();
    const reason = String(userRecord?.suspensionReason || "").trim();
    const normalizedReason = reason.toLowerCase();

    if (userRecord?.canBorrow === false || hasFutureRestriction) {
      const isTemporaryRestriction =
        normalizedReason.includes("temporary borrowing restriction") ||
        normalizedReason.includes("approved item") ||
        normalizedReason.includes("claimed/released");

      return {
        label: isTemporaryRestriction
          ? "Temporarily Restricted"
          : "Suspended",
        tone: isTemporaryRestriction ? "warning" : "danger",
        canBorrow: "No",
        until: formatBorrowingDateTime(userRecord?.suspendedUntil),
        reason:
          reason ||
          "Your borrowing access is currently restricted. Please contact the admin for assistance.",
        detail: isTemporaryRestriction
          ? "This is a short restriction. Admins can restore access early if this was caused by a release encoding mistake."
          : "Borrowing access is restricted until the admin restores your account or the suspension period ends.",
      };
    }

    return {
      label: "Good Standing",
      tone: "success",
      canBorrow: "Yes",
      until: "No active restriction",
      reason: "No active borrowing restriction.",
      detail: "You can submit borrow requests as long as items are available.",
    };
  }

  function getInitials(name, email) {
    const source = name || email || "User";

    const initials = source
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

    return initials || "U";
  }

  function revokePreview(url) {
    if (url && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }

  async function loadUserRecord(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = {
        id: userSnap.id,
        uid: user.uid,
        email: user.email,
        ...userSnap.data(),
      };

      setUserRecord(data);
      setFullName(data.fullName || "");

      if (data.photoURL) {
        setPhotoPreview(data.photoURL);
      }
    }
  }

  async function reauthenticateUser(password) {
    if (!currentUser?.email) {
      throw new Error("No logged-in user found.");
    }

    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    showStatus("", "");
    clearProfileFieldError("profilePhoto");

    if (!file.type.startsWith("image/")) {
      setProfileFieldErrors((previousErrors) => ({
        ...previousErrors,
        profilePhoto: "Please upload an image file only.",
      }));
      showBlockedAction("Please upload an image file only.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setProfileFieldErrors((previousErrors) => ({
        ...previousErrors,
        profilePhoto: "Image is too large. Please upload an image below 5MB.",
      }));
      showBlockedAction("Image is too large. Please upload an image below 5MB.");
      return;
    }

    setCropSourceFile(file);
  }

  function handleProfileCropComplete(blob, previewUrl) {
    revokePreview(photoPreview);

    setCroppedPhotoBlob(blob);
    setCroppedPhotoSize(blob.size);
    setPhotoPreview(previewUrl);
    setCropSourceFile(null);
    setProfileTouched(true);

    showStatus(
      `Profile picture cropped and compressed to ${(blob.size / 1024).toFixed(
        1
      )} KB. Click Save Settings to apply the update.`,
      "success"
    );
  }

  async function handleSaveProfile(event) {
    event.preventDefault();

    if (!currentUser) {
      showBlockedAction("No logged-in user found.");
      return;
    }

    showStatus("", "");

    const isValid = validateProfileForm();

    if (!isValid) {
      return;
    }

    const cleanedFullName = fullName.trim();

    setSavingProfile(true);

    try {
      let uploadedPhotoURL = userRecord?.photoURL || "";
      let uploadedPhotoPath = userRecord?.photoPath || "";

      if (croppedPhotoBlob) {
        uploadedPhotoPath = `profilePictures/${currentUser.uid}/avatar.jpg`;
        const photoRef = ref(storage, uploadedPhotoPath);

        await uploadBytes(photoRef, croppedPhotoBlob, {
          contentType: "image/jpeg",
          cacheControl: "public,max-age=3600",
        });

        uploadedPhotoURL = await getDownloadURL(photoRef);
      }

      const userRef = doc(db, "users", currentUser.uid);

      await updateDoc(userRef, {
        fullName: cleanedFullName,
        photoURL: uploadedPhotoURL,
        photoPath: uploadedPhotoPath,
        updatedAt: serverTimestamp(),
      });

      const updatedUserData = {
        ...userRecord,
        fullName: cleanedFullName,
        photoURL: uploadedPhotoURL,
        photoPath: uploadedPhotoPath,
      };

      setUserRecord(updatedUserData);
      setFullName(cleanedFullName);
      setCroppedPhotoBlob(null);
      setCroppedPhotoSize(0);
      setProfileFieldErrors({});
      setProfileTouched(false);

      window.dispatchEvent(
        new CustomEvent("qborrow-user-updated", {
          detail: {
            fullName: cleanedFullName,
            photoURL: uploadedPhotoURL,
            photoPath: uploadedPhotoPath,
          },
        })
      );

      showToast("Settings Saved", "success");
    } catch (error) {
      showActionError("Failed to save settings", error);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();

    if (!currentUser) {
      showStatus("No logged-in user found.", "error");
      return;
    }

    showStatus("", "");

    const isValid = validatePasswordForm();

    if (!isValid) {
      return;
    }

    setChangingPassword(true);

    try {
      await reauthenticateUser(passwordCurrent);
      await updatePassword(currentUser, newPassword);

      setPasswordCurrent("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordFieldErrors({});
      setPasswordTouched(false);

      showToast("Password Changed", "success");
    } catch (error) {
      showActionError("Failed to change password", error);
    } finally {
      setChangingPassword(false);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        showBlockedAction("Please login first.");
        setLoading(false);
        return;
      }

      setCurrentUser(user);

      try {
        await loadUserRecord(user);
      } catch (error) {
        showActionError("Failed to load settings", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setUnsavedChanges?.(
      (profileTouched || passwordTouched) && !savingProfile && !changingPassword,
      "You have unsaved settings changes. Leaving this page will discard your progress."
    );

    return () => {
      setUnsavedChanges?.(false);
    };
  }, [
    profileTouched,
    passwordTouched,
    savingProfile,
    changingPassword,
    setUnsavedChanges,
  ]);

  const hasSettingsFieldErrors =
    Object.values(profileFieldErrors).some(Boolean) ||
    Object.values(passwordFieldErrors).some(Boolean);

  const borrowingStatusInfo = getBorrowingStatusInfo();

  if (loading) {
    return (
      <div className="settings-loading">
        <div className="settings-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading settings...</h2>
          <p>Preparing your account settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      {cropSourceFile && (
        <ImageCropModal
          file={cropSourceFile}
          title="Crop Profile Picture"
          outputSize={320}
          maxOutputBytes={190 * 1024}
          onCancel={() => setCropSourceFile(null)}
          onCropComplete={handleProfileCropComplete}
        />
      )}

      <section className="settings-header settings-header-compact">
        <div className="settings-header-content">
          <div className="settings-header-text">
            <h1>Settings</h1>
            <p>
              Manage your display name, profile picture, and password. Your email
              is kept fixed for account safety.
            </p>
          </div>

          <button
            type="button"
            className="settings-secondary-btn settings-header-back-btn"
            onClick={() => {
              if (guardedNavigate) {
                guardedNavigate("/dashboard");
                return;
              }

              navigate("/dashboard");
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </section>

      {statusMessage && !hasSettingsFieldErrors && (
        <div className={`settings-status settings-status-${statusType}`}>
          {statusMessage}
        </div>
      )}

      <section className="settings-layout">
        <form
          className="settings-card settings-profile-card"
          onSubmit={handleSaveProfile}
          noValidate
        >
          <div className="settings-section-heading">
            <h2>Profile</h2>
            <p>Crop your picture and update your display name without entering your password.</p>
          </div>

          <div className="settings-profile-preview">
            <div className="settings-avatar">
              {photoPreview ? (
                <img src={photoPreview} alt="Profile preview" />
              ) : (
                <span>
                  {getInitials(fullName || userRecord?.fullName, currentUser?.email)}
                </span>
              )}
            </div>

            <div>
              <h3>{fullName || userRecord?.fullName || "Unnamed User"}</h3>
              <p>{getRoleLabel(userRecord?.role)}</p>
              <span>{currentUser?.email}</span>
            </div>
          </div>

          <div className="settings-profile-fields-grid">
            <div className="settings-field">
              <label className="qb-label" htmlFor="full-name">
                Display Name <span className="required-star">*</span>
              </label>

              <input
                id="full-name"
                type="text"
                className={profileFieldErrors.fullName ? "input-error" : ""}
                placeholder="Enter your display name"
                value={fullName}
                onFocus={() => clearProfileFieldError("fullName")}
                onBlur={() => validateProfileField("fullName")}
                onChange={(event) => {
                  const sanitizedName = sanitizePersonNameInput(event.target.value);

                  markProfileChanged();
                  setFullName(sanitizedName);
                  clearProfileFieldError("fullName");

                  if (sanitizedName !== event.target.value) {
                    setProfileFieldErrors((previousErrors) => ({
                      ...previousErrors,
                      fullName:
                        "Display name can only contain letters, spaces, dot, hyphen, and apostrophe.",
                    }));
                  }
                }}
                disabled={savingProfile}
              />

              {profileFieldErrors.fullName && (
                <p className="field-error-message">{profileFieldErrors.fullName}</p>
              )}
            </div>

            <div className="settings-field">
              <label className="qb-label" htmlFor="email">
                Email
              </label>

              <input id="email" type="email" value={currentUser?.email || ""} readOnly />
              <small>Email cannot be changed.</small>
            </div>

            <div className="settings-field">
              <label className="qb-label" htmlFor="profile-photo">
                Profile Picture
              </label>

              <input
                id="profile-photo"
                type="file"
                className={profileFieldErrors.profilePhoto ? "input-error" : ""}
                accept="image/*"
                onFocus={() => clearProfileFieldError("profilePhoto")}
                onChange={handlePhotoChange}
                disabled={savingProfile}
              />

              {profileFieldErrors.profilePhoto && (
                <p className="field-error-message">{profileFieldErrors.profilePhoto}</p>
              )}

              {croppedPhotoSize > 0 && (
                <small>
                  Compressed size: {(croppedPhotoSize / 1024).toFixed(1)} KB
                </small>
              )}
            </div>

          </div>

          <button
            type="submit"
            className="settings-primary-btn"
            disabled={savingProfile}
          >
            {savingProfile ? "Saving..." : "Save Settings"}
          </button>
        </form>

        {borrowingStatusInfo && (
          <section
            className={`settings-card settings-borrowing-status-card status-${borrowingStatusInfo.tone}`}
            aria-label="Borrowing status"
          >
            <div className="settings-section-heading">
              <h2>Borrowing Status</h2>
              <p>Check your borrowing access, restriction reason, and ending time.</p>
            </div>

            <div className="settings-borrowing-status-main">
              <span>{borrowingStatusInfo.label}</span>
              <strong>{borrowingStatusInfo.canBorrow}</strong>
            </div>

            <div className="settings-borrowing-status-grid">
              <div>
                <span>Restriction Ends</span>
                <strong>{borrowingStatusInfo.until}</strong>
              </div>

              <div>
                <span>Reason</span>
                <strong>{borrowingStatusInfo.reason}</strong>
              </div>
            </div>

            <p className="settings-borrowing-status-note">
              {borrowingStatusInfo.detail}
            </p>
          </section>
        )}

        <form
          className="settings-card settings-password-card"
          onSubmit={handleChangePassword}
          noValidate
        >
          <div className="settings-section-heading">
            <h2>Change Password</h2>
            <p>Confirm your current password before setting a new one.</p>
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="current-password">
              Current Password <span className="required-star">*</span>
            </label>

            <input
              id="current-password"
              type="password"
              className={passwordFieldErrors.passwordCurrent ? "input-error" : ""}
              placeholder="Current password"
              value={passwordCurrent}
              onFocus={() => clearPasswordFieldError("passwordCurrent")}
              onBlur={() => validatePasswordField("passwordCurrent")}
              onChange={(event) => {
                markPasswordChanged();
                setPasswordCurrent(event.target.value);
                clearPasswordFieldError("passwordCurrent");
              }}
              disabled={changingPassword}
            />

            {passwordFieldErrors.passwordCurrent && (
              <p className="field-error-message">
                {passwordFieldErrors.passwordCurrent}
              </p>
            )}
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="new-password">
              New Password <span className="required-star">*</span>
            </label>

            <input
              id="new-password"
              type="password"
              className={passwordFieldErrors.newPassword ? "input-error" : ""}
              placeholder="At least 6 characters"
              value={newPassword}
              onFocus={() => clearPasswordFieldError("newPassword")}
              onBlur={() => validatePasswordField("newPassword")}
              onChange={(event) => {
                markPasswordChanged();
                setNewPassword(event.target.value);
                clearPasswordFieldError("newPassword");
                clearPasswordFieldError("confirmNewPassword");
              }}
              disabled={changingPassword}
            />

            {passwordFieldErrors.newPassword && (
              <p className="field-error-message">{passwordFieldErrors.newPassword}</p>
            )}
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="confirm-new-password">
              Confirm Password <span className="required-star">*</span>
            </label>

            <input
              id="confirm-new-password"
              type="password"
              className={passwordFieldErrors.confirmNewPassword ? "input-error" : ""}
              placeholder="Repeat new password"
              value={confirmNewPassword}
              onFocus={() => clearPasswordFieldError("confirmNewPassword")}
              onBlur={() => validatePasswordField("confirmNewPassword")}
              onChange={(event) => {
                markPasswordChanged();
                setConfirmNewPassword(event.target.value);
                clearPasswordFieldError("confirmNewPassword");
              }}
              disabled={changingPassword}
            />

            {passwordFieldErrors.confirmNewPassword && (
              <p className="field-error-message">
                {passwordFieldErrors.confirmNewPassword}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="settings-secondary-btn"
            disabled={changingPassword}
          >
            {changingPassword ? "Changing..." : "Change Password"}
          </button>
        </form>
      </section>
    </div>
  );
}

export default Settings;
