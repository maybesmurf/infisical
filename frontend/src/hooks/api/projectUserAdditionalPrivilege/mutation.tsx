import { packRules } from "@casl/ability/extra";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

import { projectUserPrivilegeKeys } from "./queries";
import {
  TCreateProjectUserPrivilegeDTO,
  TDeleteProjectUserPrivilegeDTO,
  TProjectUserPrivilege,
  TUpdateProjectUserPrivlegeDTO
} from "./types";

export const useCreateProjectUserAdditionalPrivilege = () => {
  const queryClient = useQueryClient();

  return useMutation<{ privilege: TProjectUserPrivilege }, {}, TCreateProjectUserPrivilegeDTO>({
    mutationFn: async (dto) => {
      const { data } = await apiRequest.post("/api/v1/additional-privilege/users/permanent", {
        ...dto,
        permissions: packRules(dto.permissions)
      });
      return data.privilege;
    },
    onSuccess: (_, { projectMembershipId }) => {
      queryClient.invalidateQueries(projectUserPrivilegeKeys.list(projectMembershipId));
    }
  });
};

export const useUpdateProjectUserAdditionalPrivilege = () => {
  const queryClient = useQueryClient();

  return useMutation<{ privilege: TProjectUserPrivilege }, {}, TUpdateProjectUserPrivlegeDTO>({
    mutationFn: async (dto) => {
      const { data } = await apiRequest.patch(
        `/api/v1/additional-privilege/users/${dto.privilegeId}`,
        { ...dto, permissions: dto.permissions ? packRules(dto.permissions) : undefined }
      );
      return data.privilege;
    },
    onSuccess: (_, { projectMembershipId }) => {
      queryClient.invalidateQueries(projectUserPrivilegeKeys.list(projectMembershipId));
    }
  });
};

export const useDeleteProjectUserAdditionalPrivilege = () => {
  const queryClient = useQueryClient();

  return useMutation<{ privilege: TProjectUserPrivilege }, {}, TDeleteProjectUserPrivilegeDTO>({
    mutationFn: async (dto) => {
      const { data } = await apiRequest.delete(
        `/api/v1/additional-privilege/users/${dto.privilegeId}`
      );
      return data.privilege;
    },
    onSuccess: (_, { projectMembershipId }) => {
      queryClient.invalidateQueries(projectUserPrivilegeKeys.list(projectMembershipId));
    }
  });
};
