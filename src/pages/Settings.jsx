import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { auth, db, storage } from "../firebase/firebaseConfig";
import ImageCropModal from "../components/ImageCropModal";
import { useToast } from "../components/ToastProvider.jsx";
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

  const [themeMode, setThemeMode] = useState(
    localStorage.getItem("qborrowTheme") || "light"
  );

  const [profilePassword, setProfilePassword] = useState("");
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

    if (fieldName === "profilePassword") {
      if (!profilePassword) {
        nextErrors.profilePassword =
          "Current password is required to save changes.";
      } else {
        delete nextErrors.profilePassword;
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
        nextErrors.newPassword =
          "New password must be at least 6 characters.";
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

  if (!profilePassword) {
    errors.profilePassword = "Current password is required to save changes.";
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

  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("qborrowTheme", mode);
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

        const savedTheme =
          localStorage.getItem("qborrowTheme") || data.themeMode || "light";

        setThemeMode(savedTheme);
        applyTheme(savedTheme);

      if (data.photoURL) {
        setPhotoPreview(data.photoURL);
      }
    }
  }

  async function reauthenticateUser(password) {
    if (!currentUser?.email) {
      throw new Error("No logged-in user found.");
    }

    const credential = EmailAuthProvider.credential(
      currentUser.email,
      password
    );

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
  showStatus("Please upload an image file only.", "error");
  return;
}

if (file.size > 5 * 1024 * 1024) {
  setProfileFieldErrors((previousErrors) => ({
    ...previousErrors,
    profilePhoto: "Image is too large. Please upload an image below 5MB.",
  }));
  showStatus("Image is too large. Please upload an image below 5MB.", "error");
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
      )} KB. Enter your password to save.`,
      "success"
    );
  }

  async function handleSaveProfile(event) {
    event.preventDefault();

    if (!currentUser) {
      showStatus("No logged-in user found.", "error");
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
      await reauthenticateUser(profilePassword);

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
        themeMode,
        updatedAt: serverTimestamp(),
      });

      applyTheme(themeMode);

      const updatedUserData = {
        ...userRecord,
        fullName: cleanedFullName,
        photoURL: uploadedPhotoURL,
        photoPath: uploadedPhotoPath,
        themeMode,
      };

      setUserRecord(updatedUserData);
      setFullName(cleanedFullName);
      setCroppedPhotoBlob(null);
      setCroppedPhotoSize(0);
      setProfilePassword("");
      setProfileFieldErrors({});
      setProfileTouched(false);

      window.dispatchEvent(
        new CustomEvent("qborrow-user-updated", {
          detail: {
            fullName: cleanedFullName,
            photoURL: uploadedPhotoURL,
            photoPath: uploadedPhotoPath,
            themeMode,
          },
        })
      );

      showToast("Settings Saved", "success");
    } catch (error) {
      showStatus("Error saving settings: " + error.message, "error");
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
      showStatus("Error changing password: " + error.message, "error");
    } finally {
      setChangingPassword(false);
    }
  }

  useEffect(() => {
    const savedTheme = localStorage.getItem("qborrowTheme") || "light";
    applyTheme(savedTheme);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        return;
      }

      setCurrentUser(user);

      try {
        await loadUserRecord(user);
      } catch (error) {
        showStatus("Error loading settings: " + error.message, "error");
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


useEffect(() => {
  applyTheme(themeMode);
}, [themeMode]);

const hasSettingsFieldErrors =
  Object.values(profileFieldErrors).some(Boolean) ||
  Object.values(passwordFieldErrors).some(Boolean);

if (loading) {
    return (
      <div className="settings-loading">
        <div className="settings-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading settings...</h2>
          <p>Preparing your account preferences.</p>
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
    Manage your display name, profile picture, interface theme, and account
    password. Your email is kept fixed for account safety.
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
            <h2>Profile & Appearance</h2>
            <p>
              Uploads are manually cropped into a square and compressed to save
              Firebase Storage.
            </p>
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

          <div className="settings-field">
            <label className="qb-label" htmlFor="email">
              Email
            </label>

            <input
              id="email"
              type="email"
              value={currentUser?.email || ""}
              readOnly
            />

            <small>Email cannot be changed in this system.</small>
          </div>

          <div className="settings-theme-box">
            <div>
              <h3>Dark Mode</h3>
              <p>Switch between light and dark interface mode.</p>
            </div>

            <button
              type="button"
              className={`settings-theme-toggle ${
                themeMode === "dark" ? "active" : ""
              }`}
onClick={() => {
  markProfileChanged();

  setThemeMode((current) =>
    current === "dark" ? "light" : "dark"
  );
}}
            >
              <span></span>
              {themeMode === "dark" ? "Dark" : "Light"}
            </button>
          </div>

<div className="settings-field">
  <label className="qb-label" htmlFor="profile-password">
    Current Password Required <span className="required-star">*</span>
  </label>

  <input
    id="profile-password"
    type="password"
    className={profileFieldErrors.profilePassword ? "input-error" : ""}
    placeholder="Enter password to save changes"
    value={profilePassword}
    onFocus={() => clearProfileFieldError("profilePassword")}
    onBlur={() => validateProfileField("profilePassword")}
    onChange={(event) => {
       markProfileChanged();
      setProfilePassword(event.target.value);
      clearProfileFieldError("profilePassword");
    }}
    disabled={savingProfile}
  />

  {profileFieldErrors.profilePassword && (
    <p className="field-error-message">
      {profileFieldErrors.profilePassword}
    </p>
  )}
</div>

          <button
            type="submit"
            className="settings-primary-btn"
            disabled={savingProfile}
          >
            {savingProfile ? "Saving..." : "Save Settings"}
          </button>
        </form>

        <form
          className="settings-card settings-password-card"
          onSubmit={handleChangePassword}
          noValidate
        >
          <div className="settings-section-heading">
            <h2>Change Password</h2>
            <p>
              Your email stays the same. Enter your current password before
              setting a new one.
            </p>
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
    Confirm New Password <span className="required-star">*</span>
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