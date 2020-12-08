package com.taskr.core.storages;

import com.taskr.core.Resources.TaskTemplate;
import org.springframework.data.repository.CrudRepository;

public interface TaskTemplateRepository extends CrudRepository<TaskTemplate, Long> {
}
