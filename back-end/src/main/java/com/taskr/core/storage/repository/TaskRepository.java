package com.taskr.core.storage.repository;

import com.taskr.core.model.Task;
import org.springframework.data.repository.CrudRepository;

public interface TaskRepository extends CrudRepository<Task, Long> {
    Iterable<Task> findTasksByTemplateId(Long templateId);
}
