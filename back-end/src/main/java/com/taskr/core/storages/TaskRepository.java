package com.taskr.core.storages;

import com.taskr.core.resources.Task;
import org.springframework.data.repository.CrudRepository;

public interface TaskRepository extends CrudRepository<Task, Long> {
    Iterable<Task> findTasksByTemplateId(Long templateId);
}
