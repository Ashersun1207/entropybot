// Observe only which Safe Storage keychain names Electron asks for, and refuse
// the lookup so a probe never creates or reads a real item.
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

__attribute__((constructor)) static void prove_loaded(void) {
  const char *marker = getenv("PROBE_MARKER");
  if (!marker) return;
  FILE *file = fopen(marker, "a");
  if (file) {
    fprintf(file, "loaded\n");
    fclose(file);
  }
}

static int is_safe_storage(const char *service) {
  return service && strstr(service, "Safe Storage") != NULL;
}

static void log_cf(CFTypeRef value, char *out, size_t size) {
  out[0] = 0;
  if (value && CFGetTypeID(value) == CFStringGetTypeID()) {
    CFStringGetCString(value, out, size, kCFStringEncodingUTF8);
  } else if (value && CFGetTypeID(value) == CFDataGetTypeID()) {
    CFDataGetBytes(value, CFRangeMake(0, 0), NULL);
    snprintf(out, size, "<data>");
  }
}

static OSStatus (*orig_find_generic)(CFTypeRef, UInt32, const char *, UInt32, const char *, UInt32 *, void **, SecKeychainItemRef *);
static OSStatus (*orig_add_generic)(SecKeychainRef, UInt32, const char *, UInt32, const char *, UInt32, const void *, SecKeychainItemRef *);
static OSStatus (*orig_item_copy)(CFDictionaryRef, CFTypeRef *);
static OSStatus (*orig_item_add)(CFDictionaryRef, CFTypeRef *);

OSStatus probe_find_generic(CFTypeRef keychain, UInt32 service_len, const char *service, UInt32 account_len, const char *account, UInt32 *password_len, void **password, SecKeychainItemRef *item) {
  if (is_safe_storage(service)) {
    fprintf(stderr, "[keychain-probe] find-generic service=%.*s account=%.*s\n", (int)service_len, service, (int)account_len, account);
    return errSecItemNotFound;
  }
  if (!orig_find_generic) orig_find_generic = dlsym(RTLD_NEXT, "SecKeychainFindGenericPassword");
  return orig_find_generic(keychain, service_len, service, account_len, account, password_len, password, item);
}

OSStatus probe_add_generic(SecKeychainRef keychain, UInt32 service_len, const char *service, UInt32 account_len, const char *account, UInt32 password_len, const void *password, SecKeychainItemRef *item) {
  if (is_safe_storage(service)) {
    fprintf(stderr, "[keychain-probe] add-generic-refused service=%.*s account=%.*s\n", (int)service_len, service, (int)account_len, account);
    return errSecDuplicateItem;
  }
  if (!orig_add_generic) orig_add_generic = dlsym(RTLD_NEXT, "SecKeychainAddGenericPassword");
  return orig_add_generic(keychain, service_len, service, account_len, account, password_len, password, item);
}

OSStatus probe_item_copy(CFDictionaryRef query, CFTypeRef *result) {
  char service[256], account[256];
  log_cf(CFDictionaryGetValue(query, kSecAttrService), service, sizeof(service));
  log_cf(CFDictionaryGetValue(query, kSecAttrAccount), account, sizeof(account));
  if (is_safe_storage(service)) {
    fprintf(stderr, "[keychain-probe] item-copy service=%s account=%s\n", service, account);
    return errSecItemNotFound;
  }
  if (!orig_item_copy) orig_item_copy = dlsym(RTLD_NEXT, "SecItemCopyMatching");
  return orig_item_copy(query, result);
}

OSStatus probe_item_add(CFDictionaryRef attributes, CFTypeRef *result) {
  char service[256], account[256];
  log_cf(CFDictionaryGetValue(attributes, kSecAttrService), service, sizeof(service));
  log_cf(CFDictionaryGetValue(attributes, kSecAttrAccount), account, sizeof(account));
  if (is_safe_storage(service)) {
    fprintf(stderr, "[keychain-probe] item-add-refused service=%s account=%s\n", service, account);
    return errSecDuplicateItem;
  }
  if (!orig_item_add) orig_item_add = dlsym(RTLD_NEXT, "SecItemAdd");
  return orig_item_add(attributes, result);
}

#define INTERPOSE(replacement, replacee) \
  __attribute__((used)) static struct { const void *replacement; const void *replacee; } _interpose_##replacee \
  __attribute__((section("__DATA,__interpose"))) = { (const void *)(unsigned long)&replacement, (const void *)(unsigned long)&replacee }

INTERPOSE(probe_find_generic, SecKeychainFindGenericPassword);
INTERPOSE(probe_add_generic, SecKeychainAddGenericPassword);
INTERPOSE(probe_item_copy, SecItemCopyMatching);
INTERPOSE(probe_item_add, SecItemAdd);
