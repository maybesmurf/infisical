import { ForbiddenError, subject } from "@casl/ability";

import { SecretKeyEncoding } from "@app/db/schemas";
import { TPermissionServiceFactory } from "@app/ee/services/permission/permission-service";
import { ProjectPermissionActions, ProjectPermissionSub } from "@app/ee/services/permission/project-permission";
import { infisicalSymmetricDecrypt, infisicalSymmetricEncypt } from "@app/lib/crypto/encryption";
import { BadRequestError } from "@app/lib/errors";

import { TDynamicSecretLeaseDALFactory } from "../dynamic-secret-lease/dynamic-secret-lease-dal";
import { TDynamicSecretLeaseQueueServiceFactory } from "../dynamic-secret-lease/dynamic-secret-lease-queue";
import { TSecretFolderDALFactory } from "../secret-folder/secret-folder-dal";
import { TDynamicSecretDALFactory } from "./dynamic-secret-dal";
import {
  TCreateDynamicSecretDTO,
  TDeleteDyanmicSecretDTO,
  TListDyanmicSecretsDTO,
  TUpdateDynamicSecretDTO
} from "./dynamic-secret-types";
import { DynamicSecretProviders, TDynamicProviderFns } from "./providers/models";

type TDynamicSecretServiceFactoryDep = {
  dynamicSecretDAL: TDynamicSecretDALFactory;
  dynamicSecretLeaseDAL: Pick<TDynamicSecretLeaseDALFactory, "find">;
  dynamicSecretProviders: Record<DynamicSecretProviders, TDynamicProviderFns>;
  dynamicSecretQueueService: Pick<TDynamicSecretLeaseQueueServiceFactory, "pruneDynamicSecret">;
  folderDAL: Pick<TSecretFolderDALFactory, "findBySecretPath">;
  permissionService: Pick<TPermissionServiceFactory, "getProjectPermission">;
};

export type TDynamicSecretServiceFactory = ReturnType<typeof dynamicSecretServiceFactory>;

export const dynamicSecretServiceFactory = ({
  dynamicSecretDAL,
  dynamicSecretLeaseDAL,
  folderDAL,
  dynamicSecretProviders,
  permissionService,
  dynamicSecretQueueService
}: TDynamicSecretServiceFactoryDep) => {
  const create = async ({
    path,
    actor,
    slug,
    actorId,
    maxTTL,
    provider,
    environment,
    projectId,
    actorOrgId,
    defaultTTL,
    actorAuthMethod
  }: TCreateDynamicSecretDTO) => {
    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      projectId,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Create,
      subject(ProjectPermissionSub.Secrets, { environment, secretPath: path })
    );

    const folder = await folderDAL.findBySecretPath(projectId, environment, path);
    if (!folder) throw new BadRequestError({ message: "Folder not found" });

    const existingDynamicSecret = await dynamicSecretDAL.findOne({ slug, folderId: folder.id });
    if (existingDynamicSecret)
      throw new BadRequestError({ message: "Provided dynamic secret already exist under the folder" });

    const selectedProvider = dynamicSecretProviders[provider.type];
    const inputs = await selectedProvider.validateProviderInputs(provider.inputs);
    const encryptedInput = infisicalSymmetricEncypt(JSON.stringify(inputs));
    const dynamicSecretCfg = await dynamicSecretDAL.create({
      type: provider.type,
      version: 1,
      inputIV: encryptedInput.iv,
      inputTag: encryptedInput.tag,
      inputCiphertext: encryptedInput.ciphertext,
      algorithm: encryptedInput.algorithm,
      keyEncoding: encryptedInput.encoding,
      maxTTL,
      defaultTTL,
      folderId: folder.id,
      slug
    });
    return dynamicSecretCfg;
  };

  const updateBySlug = async ({
    slug,
    maxTTL,
    defaultTTL,
    inputs,
    environment,
    projectId,
    path,
    actor,
    actorId,
    newSlug,
    actorOrgId,
    actorAuthMethod
  }: TUpdateDynamicSecretDTO) => {
    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      projectId,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Edit,
      subject(ProjectPermissionSub.Secrets, { environment, secretPath: path })
    );

    const folder = await folderDAL.findBySecretPath(projectId, environment, path);
    if (!folder) throw new BadRequestError({ message: "Folder not found" });

    const dynamicSecretCfg = await dynamicSecretDAL.findOne({ slug, folderId: folder.id });
    if (!dynamicSecretCfg) throw new BadRequestError({ message: "Dynamic secret not found" });

    if (newSlug) {
      const existingDynamicSecret = await dynamicSecretDAL.findOne({ slug: newSlug, folderId: folder.id });
      if (existingDynamicSecret)
        throw new BadRequestError({ message: "Provided dynamic secret already exist under the folder" });
    }

    const selectedProvider = dynamicSecretProviders[dynamicSecretCfg.type as DynamicSecretProviders];
    const decryptedStoredInput = JSON.parse(
      infisicalSymmetricDecrypt({
        keyEncoding: dynamicSecretCfg.keyEncoding as SecretKeyEncoding,
        ciphertext: dynamicSecretCfg.inputCiphertext,
        tag: dynamicSecretCfg.inputTag,
        iv: dynamicSecretCfg.inputIV
      })
    ) as object;
    const newInput = { ...decryptedStoredInput, ...(inputs || {}) };
    const updatedInput = await selectedProvider.validateProviderInputs(newInput);
    const encryptedInput = infisicalSymmetricEncypt(JSON.stringify(updatedInput));
    const updatedDynamicCfg = await dynamicSecretDAL.updateById(dynamicSecretCfg.id, {
      inputIV: encryptedInput.iv,
      inputTag: encryptedInput.tag,
      inputCiphertext: encryptedInput.ciphertext,
      algorithm: encryptedInput.algorithm,
      keyEncoding: encryptedInput.encoding,
      maxTTL,
      defaultTTL,
      slug: newSlug ?? slug
    });

    return updatedDynamicCfg;
  };

  const deleteBySlug = async ({
    actorAuthMethod,
    actorOrgId,
    actorId,
    actor,
    projectId,
    slug,
    path,
    environment
  }: TDeleteDyanmicSecretDTO) => {
    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      projectId,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Edit,
      subject(ProjectPermissionSub.Secrets, { environment, secretPath: path })
    );

    const folder = await folderDAL.findBySecretPath(projectId, environment, path);
    if (!folder) throw new BadRequestError({ message: "Folder not found" });

    const dynamicSecretCfg = await dynamicSecretDAL.findOne({ slug, folderId: folder.id });
    if (!dynamicSecretCfg) throw new BadRequestError({ message: "Dynamic secret not found" });

    const leases = await dynamicSecretLeaseDAL.find({ dynamicSecretId: dynamicSecretCfg.id });
    // if leases exist we should flag it as deleting and then remove leases in background
    // then delete the main one
    if (leases.length) {
      const updatedDynamicSecretCfg = await dynamicSecretDAL.updateById(dynamicSecretCfg.id, { isDeleting: true });
      await dynamicSecretQueueService.pruneDynamicSecret(updatedDynamicSecretCfg.id);
      return updatedDynamicSecretCfg;
    }
    // if no leases just delete the config
    const deletedDynamicSecretCfg = await dynamicSecretDAL.deleteById(dynamicSecretCfg.id);
    return deletedDynamicSecretCfg;
  };

  const list = async ({
    actorAuthMethod,
    actorOrgId,
    actorId,
    actor,
    projectId,
    path,
    environment
  }: TListDyanmicSecretsDTO) => {
    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      projectId,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Edit,
      subject(ProjectPermissionSub.Secrets, { environment, secretPath: path })
    );

    const folder = await folderDAL.findBySecretPath(projectId, environment, path);
    if (!folder) throw new BadRequestError({ message: "Folder not found" });

    const dynamicSecretCfg = await dynamicSecretDAL.find({ folderId: folder.id });
    return dynamicSecretCfg;
  };

  return {
    create,
    updateBySlug,
    deleteBySlug,
    list
  };
};
